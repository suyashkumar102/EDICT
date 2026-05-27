import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';

import { composeRoot, defaultSettings, type CompositionRoot } from '@bootstrap/CompositionRoot';
import {
  alignModelToProvider,
  resolveLLMCredentials,
  resolveSettingsFromDevvit,
} from '@bootstrap/SettingsResolver';
import { buildDevvitRedisGateway } from '@infrastructure/redis/DevvitRedisGateway';
import { buildDevvitProductionAdapter } from '@infrastructure/devvit/DevvitProductionAdapter';
import { buildTemplateGallery } from '@infrastructure/devvit/TemplateGallery';
import { buildRedisEventStore } from '@infrastructure/eventstore/RedisEventStore';
import { buildMenuRoutes } from '@interface/routes/MenuRoutes';
import { buildFormRoutes } from '@interface/routes/FormRoutes';
import { buildTriggerRoutes } from '@interface/routes/TriggerRoutes';
import { buildSchedulerRoutes } from '@interface/routes/SchedulerRoutes';
import { buildValidationRoutes } from '@interface/routes/ValidationRoutes';
import type { LLMPort } from '@compilation/llm/CompilerService';
import { buildOpenAiLLMClient } from '@compilation/llm/OpenAiLLMClient';
import { buildGeminiLLMClient } from '@compilation/llm/GeminiLLMClient';

/**
 * Devvit entry point. Compiled by Vite into
 * `distribution/server/Bootstrap.cjs`. `devvit.json` points at this file
 * via `server.entry`.
 *
 * Devvit invokes the exported `app.fetch` for every request — menu items,
 * forms, triggers, scheduler ticks. The Hono app routes them to layer-
 * specific routers (Menu / Form / Trigger / Scheduler / Validation),
 * each of which has its own composition root.
 *
 * Wiring proceeds in three stages:
 *
 *   1. At module load we build a composition root pointed at the *real*
 *      Devvit Redis (`buildDevvitRedisGateway`) and the *real* Devvit-
 *      backed adapter (`buildDevvitProductionAdapter`). The provider
 *      credentials and Devvit settings are async, so we seed with safe
 *      defaults (sandboxMode=true, no-LLM stub) and let stage 2 swap
 *      them in.
 *
 *   2. A pre-middleware (`refreshDynamicConfig`) runs at most once every
 *      30 s. On the first call it resolves the moderator-selected LLM
 *      credentials from the Devvit secrets store (OpenAI or Gemini —
 *      both on Reddit's PR-#96 approved list) and replaces the stub
 *      compiler with the live one. On every call it refreshes the
 *      settings block so toggling a kill-switch mid-incident propagates
 *      within ~30 s rather than waiting for the next deploy.
 *
 *   3. Each layer-specific router is mounted under its dedicated
 *      `/internal/*` prefix exactly as declared in `devvit.json`.
 */

const templates = buildTemplateGallery();
const productionRedis = buildDevvitRedisGateway();
const productionAdapter = buildDevvitProductionAdapter({
  events: buildRedisEventStore(productionRedis),
  templates,
});

/**
 * Mutable LLM proxy. composeRoot binds the compiler (and therefore the
 * commandBus's reference to it) to this proxy *once*. When the dynamic-
 * config refresh later resolves credentials, we mutate `proxy.inner`
 * rather than replacing `root.compiler` — the commandBus's bound
 * reference is unchanged, but every call now routes through to the
 * real client.
 *
 * Without this indirection, swapping `root.compiler` left commandBus
 * holding the stub forever (which is how a Gemini-configured install
 * still kept returning "no-llm-configured" — the symptom that surfaced
 * the bug at v0.0.10).
 */
const llmProxy: LLMPort = {
  inner: { invoke: async () => ({ kind: 'rawText', text: 'no-llm-configured' as const }) },
  async invoke(inv) {
    return this.inner.invoke(inv);
  },
} as LLMPort & { inner: LLMPort };

const root: CompositionRoot = composeRoot({
  redis: productionRedis,
  devvitAdapter: productionAdapter,
  llmClient: llmProxy,
  settings: defaultSettings(),
});

const SETTINGS_REFRESH_MS = 30_000;
let lastRefresh = 0;
let llmWired = false;
let wiredProvider: 'openai' | 'gemini' | 'none' = 'none';

const refreshDynamicConfig = async (): Promise<void> => {
  const now = Date.now();
  if (llmWired && now - lastRefresh < SETTINGS_REFRESH_MS) return;

  try {
    if (!llmWired) {
      const creds = await resolveLLMCredentials();
      if (creds) {
        const client: LLMPort =
          creds.provider === 'gemini'
            ? buildGeminiLLMClient({ apiKey: creds.apiKey })
            : buildOpenAiLLMClient({ apiKey: creds.apiKey });
        // Mutate the proxy's inner reference; commandBus's bound
        // compiler keeps the same outer reference and now dispatches
        // to the real client transparently.
        (llmProxy as LLMPort & { inner: LLMPort }).inner = client;
        wiredProvider = creds.provider;
        console.log(`[edict] LLM wired: provider=${creds.provider}`);
      }
      llmWired = true;
    }
    const resolved = await resolveSettingsFromDevvit();
    // Auto-correct compilerModel when it doesn't belong to the chosen
    // provider. Saves moderators from a brittle two-dropdown coupling
    // in Install Settings.
    if (wiredProvider === 'openai' || wiredProvider === 'gemini') {
      const aligned = alignModelToProvider(resolved.compilerModel, wiredProvider);
      if (aligned !== resolved.compilerModel) {
        (root as { settings: CompositionRoot['settings'] }).settings = {
          ...resolved,
          compilerModel: aligned,
        };
      } else {
        (root as { settings: CompositionRoot['settings'] }).settings = resolved;
      }
    } else {
      (root as { settings: CompositionRoot['settings'] }).settings = resolved;
    }
    lastRefresh = now;
  } catch (err) {
    // Defaults are safe (sandboxMode=true, no-LLM stub refuses compiles),
    // so swallow + warn rather than 500ing the whole platform.
    console.warn('[edict] dynamic config refresh failed:', String(err));
  }
};

export const app = new Hono();

app.use('*', async (c, next) => {
  console.log(`[edict] request: ${c.req.method} ${c.req.path}`);
  await refreshDynamicConfig();
  console.log(
    `[edict] post-refresh: llmWired=${llmWired} provider=${wiredProvider} model=${root.settings.compilerModel}`,
  );
  await next();
});

app.route('/internal/menu', buildMenuRoutes(root));
app.route('/internal/form', buildFormRoutes(root));
app.route('/internal/trigger', buildTriggerRoutes(root));
app.route('/internal/scheduler', buildSchedulerRoutes(root));
app.route('/internal/validate', buildValidationRoutes());

app.get('/internal/health', (c) =>
  c.json({
    ok: true,
    version: '1.0.0',
    llmWired,
    wiredProvider,
    settingsAgeMs: lastRefresh ? Date.now() - lastRefresh : null,
  }),
);

export default app;

// Devvit Web server bootstrap — official template pattern.
//
//   serve({ fetch: app.fetch, createServer, port: getServerPort() })
//
// `@hono/node-server`'s `serve` builds a proper Node IncomingMessage →
// Web `Request` adapter. Crucially it accepts a `createServer` option,
// so the entire adapter pipeline runs inside Devvit's `createServer`
// wrapper — which installs the per-request `runWithContext(...)` that
// our DevvitContext helpers read `context.subredditName` / `username`
// from. Without this call, the bundle exports an `app` but Devvit's
// runtime has nothing to wire it into.
//
// Gate on WEBBIT_PORT so `node -e "require('./Bootstrap.cjs')"` smoke
// loads (CI module-load check) don't bind a port and hang. The Devvit
// runtime is the only environment that supplies WEBBIT_PORT.
if (
  typeof createServer === 'function' &&
  typeof getServerPort === 'function' &&
  process.env['WEBBIT_PORT']
) {
  try {
    serve({
      fetch: app.fetch,
      createServer,
      port: getServerPort(),
    });
  } catch (err) {
    // In tests / non-Devvit runtimes, `createServer` / `getServerPort`
    // are stubbed — silently skip so module load doesn't crash.
    console.warn('[edict] server bootstrap skipped (test or non-Devvit runtime):', err);
  }
}

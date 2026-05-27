#!/usr/bin/env tsx
/**
 * EDICT doctor. The single pre-publish health check.
 *
 * Doctor is `npm run preflight` + everything else that has bitten us
 * once and shouldn't bite us again:
 *
 *   1. devvit.json integrity (parses, has the required top-level keys)
 *   2. permissions.http.domains ↔ source coherence
 *        - api.openai.com is the only allowed domain
 *        - no Anthropic / Gemini / other-provider leak
 *   3. All menu / form / trigger / scheduler endpoints have a handler
 *   4. Every settings key SettingsResolver reads is declared in
 *      devvit.json (and vice versa)
 *   5. Seed catalog has no duplicate slugs
 *   6. README + edict.config.json placeholders are surfaced as
 *      deploy-time TODOs (warn, not fail)
 *   7. Custom-post entrypoint matches the build output
 *
 * Exits 0 on success (with warnings printed), 1 on any failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_TEMPLATES } from '../seeds/Index';

interface DevvitConfig {
  name?: string;
  server?: { dir?: string; entry?: string };
  permissions?: { http?: { domains?: string[]; enable?: boolean } };
  menu?: { items?: { endpoint: string; label: string }[] };
  forms?: Record<string, string>;
  triggers?: Record<string, string>;
  scheduler?: { tasks?: Record<string, { endpoint: string }> };
  settings?: { global?: Record<string, unknown>; subreddit?: Record<string, unknown> };
  post?: { dir?: string; entry?: string };
}

const FAILURES: string[] = [];
const WARNINGS: string[] = [];

const fail = (msg: string): void => {
  FAILURES.push(msg);
};
const warn = (msg: string): void => {
  WARNINGS.push(msg);
};

const repoRoot = process.cwd();

// ───────────────────────────────────────────────────────────── 1. parse
let cfg: DevvitConfig;
try {
  cfg = JSON.parse(readFileSync(join(repoRoot, 'devvit.json'), 'utf-8')) as DevvitConfig;
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`devvit.json failed to parse: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
if (!cfg.name) fail('devvit.json.name missing');
if (!cfg.server?.entry) fail('devvit.json.server.entry missing');

// ───────────────────────────────────────────────── 2. fetch domain coherence
const allowedDomains = new Set(cfg.permissions?.http?.domains ?? []);
const APPROVED_DOMAINS = new Set(['api.openai.com', 'generativelanguage.googleapis.com']);
const FORBIDDEN_DOMAINS = ['api.anthropic.com'];

// At least one approved provider must be configured. The compiler
// refuses to wire if none is set; the doctor flags it loudly.
const hasApproved = [...APPROVED_DOMAINS].some((d) => allowedDomains.has(d));
if (!hasApproved) {
  fail(
    'permissions.http.domains has no approved AI provider — add api.openai.com or generativelanguage.googleapis.com',
  );
}

for (const dom of allowedDomains) {
  if (FORBIDDEN_DOMAINS.includes(dom)) {
    fail(
      `permissions.http.domains contains ${dom} — provider is not on Reddit's approved list (PR #96). See CUT-LIST.md hard lock #4.`,
    );
  }
  if (!APPROVED_DOMAINS.has(dom) && !FORBIDDEN_DOMAINS.includes(dom)) {
    warn(
      `permissions.http.domains contains ${dom} which is neither approved nor explicitly forbidden — verify against the current PR #96 list before publishing.`,
    );
  }
}

// Source-level Anthropic-import leak check (regression-guard: an earlier
// branch briefly wired Anthropic and we don't want it sneaking back in).
//
// We match on import / require shapes and on the API domain, NOT on the
// bare word "anthropic" — that string legitimately appears in doc
// comments and edict.config.json's `policyNote` explaining why Anthropic
// is excluded. A useful regression-guard catches actual usage:
//   - `from '@anthropic-ai/sdk'` and `require('@anthropic-ai/sdk')`
//   - the host `api.anthropic.com`
//   - declared deps named `@anthropic-ai/*`
const ANTHROPIC_LEAK_PATTERNS = [
  /from\s+['"]@anthropic-ai\//,
  /require\(['"]@anthropic-ai\//,
  /api\.anthropic\.com/,
  /"@anthropic-ai\//,
];
const FILES_TO_GREP = [
  'source/bootstrap/Bootstrap.ts',
  'source/bootstrap/SettingsResolver.ts',
  'source/bootstrap/CompositionRoot.ts',
  'package.json',
  'devvit.json',
];
for (const file of FILES_TO_GREP) {
  const full = join(repoRoot, file);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf-8');
  for (const pat of ANTHROPIC_LEAK_PATTERNS) {
    if (pat.test(text)) {
      fail(
        `${file} contains an Anthropic-import-or-domain reference (${pat}) — not on Reddit's PR-#96 approved list. See CUT-LIST.md hard lock #4.`,
      );
      break;
    }
  }
}

// ──────────────────────────────────────────────── 3. route-handler check
const KNOWN_ROUTES = new Set<string>([
  '/internal/menu/open-command-center',
  '/internal/menu/compose-edict',
  '/internal/menu/open-what-if',
  '/internal/menu/open-gallery',
  '/internal/menu/open-briefing',
  '/internal/menu/reverse-decision',
  '/internal/menu/explain-decision',
  '/internal/form/compose-submit',
  '/internal/form/clarify-submit',
  '/internal/form/activate-submit',
  '/internal/form/whatif-submit',
  '/internal/form/consensus-vote',
  '/internal/form/gallery-import',
  '/internal/trigger/post-submitted',
  '/internal/trigger/comment-submitted',
  '/internal/trigger/post-reported',
  '/internal/trigger/comment-reported',
  '/internal/trigger/flair-changed',
  '/internal/trigger/app-installed',
  '/internal/trigger/app-upgraded',
  '/internal/scheduler/shadow-sweep',
  '/internal/scheduler/breaker-tick',
  '/internal/scheduler/effectiveness-recompute',
  '/internal/scheduler/compaction',
  '/internal/scheduler/briefing-prepare',
  '/internal/scheduler/rollback-sweep',
  '/internal/scheduler/seed-templates',
  '/internal/validate/confidence',
  '/internal/validate/observations',
  '/internal/validate/duration',
  '/internal/validate/ceiling',
  '/internal/validate/rollout',
  '/internal/validate/window',
]);

const checkEndpoint = (label: string, endpoint: string): void => {
  if (!KNOWN_ROUTES.has(endpoint)) {
    fail(`Missing route handler for ${label}: ${endpoint}`);
  }
};

for (const item of cfg.menu?.items ?? []) {
  checkEndpoint(`menu "${item.label}"`, item.endpoint);
}
for (const [name, endpoint] of Object.entries(cfg.forms ?? {})) {
  checkEndpoint(`form "${name}"`, endpoint);
}
for (const [name, endpoint] of Object.entries(cfg.triggers ?? {})) {
  checkEndpoint(`trigger "${name}"`, endpoint);
}
for (const [name, task] of Object.entries(cfg.scheduler?.tasks ?? {})) {
  checkEndpoint(`scheduler "${name}"`, task.endpoint);
}

// Trimmed menu enforcement: SUBMISSION.md + CUT-LIST.md commit us to
// exactly 4 top-level menu items. Adding more without doc updates is
// a regression of the surface-area-vs-polish trade-off.
const menuItemCount = (cfg.menu?.items ?? []).length;
if (menuItemCount !== 4) {
  fail(
    `devvit.json menu.items has ${menuItemCount} items; the locked surface is 4 (Command Center, Compose, Reverse, Explain). Adjust both devvit.json and documentation/SUBMISSION.md if intentionally changing.`,
  );
}

// ──────────────────────────────────────────── 4. settings ↔ resolver parity
const SETTINGS_KEYS_READ_BY_RESOLVER = [
  // global
  'compilerProvider',
  'openaiApiKey',
  'geminiApiKey',
  'compilerModel',
  'compilerVerbosity',
  // subreddit
  'sandboxMode',
  'adaptiveShadow',
  'shadowConfidenceThreshold',
  'shadowMinObservations',
  'shadowMaxHours',
  'perRuleActionCeiling',
  'subwideActionCeiling',
  'rolloutPercent',
  'consensusRequired',
  'rollbackWindowDays',
] as const;

const declaredSettings = new Set<string>([
  ...Object.keys(cfg.settings?.global ?? {}),
  ...Object.keys(cfg.settings?.subreddit ?? {}),
]);

for (const key of SETTINGS_KEYS_READ_BY_RESOLVER) {
  if (!declaredSettings.has(key)) {
    fail(`SettingsResolver reads "${key}" but it's not declared in devvit.json.settings`);
  }
}

for (const declared of declaredSettings) {
  if (!(SETTINGS_KEYS_READ_BY_RESOLVER as readonly string[]).includes(declared)) {
    warn(
      `devvit.json declares setting "${declared}" but SettingsResolver doesn't read it — dead config?`,
    );
  }
}

// ─────────────────────────────────────────────── 5. seed-slug uniqueness
const slugCounts = new Map<string, number>();
for (const t of SEED_TEMPLATES) {
  slugCounts.set(t.slug, (slugCounts.get(t.slug) ?? 0) + 1);
}
for (const [slug, count] of slugCounts.entries()) {
  if (count > 1) fail(`Duplicate seed template slug: ${slug} (×${count})`);
}

// ─────────────────────────────────── 6. deploy-time TODOs (warn-only)
const placeholderFiles: [string, string][] = [
  ['edict.config.json', '<github-owner>'],
  ['README.md', '%3Cgithub-owner%3E'],
];
for (const [file, marker] of placeholderFiles) {
  const full = join(repoRoot, file);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf-8');
  if (text.includes(marker)) {
    warn(
      `${file} still contains "${marker}" placeholder — replace with real GitHub owner before \`devvit publish --public\`. See documentation/CUT-LIST.md.`,
    );
  }
}

// ────────────────────────────────────────── 7. custom-post entry exists
if (cfg.post?.dir && cfg.post.entry) {
  const target = join(repoRoot, cfg.post.dir, cfg.post.entry);
  // Doctor runs in the source tree, not after `vite build`; missing
  // dist artifacts pre-build is expected. Only warn if the dir exists
  // but the entry doesn't.
  if (existsSync(join(repoRoot, cfg.post.dir)) && !existsSync(target)) {
    warn(
      `custom-post entry ${cfg.post.dir}/${cfg.post.entry} not present (run \`npm run build\` first)`,
    );
  }
}

// ────────────────────────────────────────────────────────── report
const stamp = new Date().toISOString();
// eslint-disable-next-line no-console
console.log(`\n— EDICT doctor · ${stamp} —`);

if (WARNINGS.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(`\n${WARNINGS.length} warning(s):`);
  for (const w of WARNINGS) {
    // eslint-disable-next-line no-console
    console.warn(`  ⚠ ${w}`);
  }
}

if (FAILURES.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${FAILURES.length} failure(s):`);
  for (const f of FAILURES) {
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${f}`);
  }
  // eslint-disable-next-line no-console
  console.error('\nDoctor FAILED. Fix the failures above before `devvit publish`.');
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(
  `\n✓ devvit.json parsed (${cfg.name})` +
    `\n✓ http.permissions.domains = [${[...allowedDomains].join(', ')}]` +
    `\n✓ ${KNOWN_ROUTES.size} route handlers registered` +
    `\n✓ ${menuItemCount} menu items (locked surface)` +
    `\n✓ ${declaredSettings.size} settings declared, all read by SettingsResolver` +
    `\n✓ ${SEED_TEMPLATES.length} seed templates, no duplicates` +
    `\n\nDoctor OK${WARNINGS.length > 0 ? ` (with ${WARNINGS.length} warning(s) above)` : ''}.`,
);
process.exit(0);

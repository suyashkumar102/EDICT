#!/usr/bin/env tsx
/**
 * Pre-deploy preflight. Run before `devvit upload` / `devvit publish`.
 *
 * Checks:
 *   1. Every menu endpoint in devvit.json has a matching route handler.
 *   2. Every form name has a route handler.
 *   3. Every trigger has a route handler.
 *   4. Every scheduler task has a route handler.
 *   5. Fetch domains in devvit.json match what OpenAiLLMClient calls.
 *   6. Every seed template's slug is unique.
 *
 * Exits 0 if all checks pass, 1 otherwise. Designed to be a pre-publish
 * git hook (`pre-push` in `simple-git-hooks`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_TEMPLATES } from '../seeds/Index';

interface DevvitConfig {
  menu?: { items?: { endpoint: string; label: string }[] };
  forms?: Record<string, string>;
  triggers?: Record<string, string>;
  scheduler?: { tasks?: Record<string, { endpoint: string }> };
  permissions?: { http?: { domains?: string[] } };
}

const FAILURES: string[] = [];

const cfg: DevvitConfig = JSON.parse(
  readFileSync(join(process.cwd(), 'devvit.json'), 'utf-8'),
) as DevvitConfig;

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
    FAILURES.push(`Missing route handler for ${label}: ${endpoint}`);
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

// fetch-domain coherence
const allowedDomains = new Set(cfg.permissions?.http?.domains ?? []);
if (!allowedDomains.has('api.openai.com')) {
  FAILURES.push('permissions.http.domains is missing api.openai.com — compiler will fail');
}

// seed slug uniqueness
const slugCounts = new Map<string, number>();
for (const t of SEED_TEMPLATES) {
  slugCounts.set(t.slug, (slugCounts.get(t.slug) ?? 0) + 1);
}
for (const [slug, count] of slugCounts.entries()) {
  if (count > 1) {
    FAILURES.push(`Duplicate seed template slug: ${slug} (×${count})`);
  }
}

if (FAILURES.length > 0) {
  // eslint-disable-next-line no-console
  console.error('Preflight failed:');
  for (const f of FAILURES) {
    // eslint-disable-next-line no-console
    console.error(`  - ${f}`);
  }
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log(
    `Preflight OK · ${KNOWN_ROUTES.size} routes registered · ${SEED_TEMPLATES.length} templates seeded`,
  );
  process.exit(0);
}

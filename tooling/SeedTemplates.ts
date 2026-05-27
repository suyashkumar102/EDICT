#!/usr/bin/env tsx
/**
 * Seed templates printer. Useful when iterating on the gallery — runs
 * `tsx tooling/SeedTemplates.ts` to dump the curated list with their
 * categories and English sources, then redirects to a markdown doc.
 *
 * Not a production tool. Convenience only.
 */
import { SEED_TEMPLATES } from '../seeds/Index';

const byCategory = new Map<string, (typeof SEED_TEMPLATES)[number][]>();
for (const t of SEED_TEMPLATES) {
  const list = byCategory.get(t.category) ?? [];
  list.push(t);
  byCategory.set(t.category, list);
}

const order = ['safety', 'quality', 'spam', 'civility', 'moderation', 'community'];

// eslint-disable-next-line no-console
console.log(`# EDICT Template Gallery (${SEED_TEMPLATES.length} templates)\n`);
for (const cat of order) {
  const list = byCategory.get(cat) ?? [];
  if (list.length === 0) continue;
  // eslint-disable-next-line no-console
  console.log(`## ${cat[0]?.toUpperCase() ?? ''}${cat.slice(1)} (${list.length})\n`);
  for (const t of list) {
    // eslint-disable-next-line no-console
    console.log(`### ${t.title}\n`);
    // eslint-disable-next-line no-console
    console.log(`> ${t.summary}\n`);
    // eslint-disable-next-line no-console
    console.log(`**Slug:** \`${t.slug}\` · **Suggested shadow:** ${t.suggestedShadowHours}h\n`);
    // eslint-disable-next-line no-console
    console.log(`*"${t.englishSource}"*\n`);
  }
}

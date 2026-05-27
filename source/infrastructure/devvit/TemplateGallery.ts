import { SEED_TEMPLATES } from '../../../seeds/Index';

/**
 * Curated template gallery. Templates live in the `seeds/` directory as
 * data files (one per template). At install time, the seed-templates-on-
 * install scheduler bulk-loads them into Redis for fast listing.
 *
 * Categories supported by the gallery filter:
 *   - safety         (low-karma, low-tenure, anti-doxxing)
 *   - quality        (low-effort, all-caps, off-topic)
 *   - spam           (URL shorteners, promo links, repeat poster)
 *   - civility       (slur lists, tone-policing)
 *   - moderation     (mod queue routing, escalations)
 *   - community      (welcome new users, weekly thread enforcement)
 */

export type TemplateCategory =
  | 'safety'
  | 'quality'
  | 'spam'
  | 'civility'
  | 'moderation'
  | 'community';

export interface RuleTemplate {
  readonly slug: string;
  readonly category: TemplateCategory;
  readonly title: string;
  readonly summary: string;
  readonly englishSource: string;
  readonly suggestedShadowHours: number;
}

export interface TemplateGallery {
  list(category?: string): readonly RuleTemplate[];
  get(slug: string): RuleTemplate | null;
}

export const buildTemplateGallery = (): TemplateGallery => ({
  list: (category) => {
    if (!category) return SEED_TEMPLATES;
    return SEED_TEMPLATES.filter((t) => t.category === category);
  },
  get: (slug) => SEED_TEMPLATES.find((t) => t.slug === slug) ?? null,
});

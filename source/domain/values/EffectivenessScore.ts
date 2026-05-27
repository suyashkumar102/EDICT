import { brandUnitInterval, type UnitInterval } from '@shared/types/BrandedPrimitives';

/**
 * EffectivenessScore captures whether a rule is doing useful moderation work:
 *
 *     score = (matches − reversals − conflictPenalties) / max(matches, 1)
 *
 * - matches:           total live actions taken
 * - reversals:         mod overrides via "Reverse this decision"
 * - conflictPenalties: counts when this rule's verdict was overridden by a
 *                      stricter rule on the same item (double-action attempts)
 *
 * Clamped to 0..1 — a rule whose reversals exceed matches scores 0, not -1.
 * Effectiveness re-computes every 2 h (see scheduler/effectiveness-recompute).
 */
export type EffectivenessScore = UnitInterval & { readonly __score: 'EffectivenessScore' };

export interface EffectivenessSnapshot {
  readonly matches: number;
  readonly reversals: number;
  readonly conflictPenalties: number;
  readonly computedAt: number;
  readonly score: EffectivenessScore;
}

export const computeEffectiveness = (input: {
  readonly matches: number;
  readonly reversals: number;
  readonly conflictPenalties: number;
  readonly computedAt: number;
}): EffectivenessSnapshot => {
  const { matches, reversals, conflictPenalties } = input;
  if (matches === 0) {
    return {
      matches,
      reversals,
      conflictPenalties,
      computedAt: input.computedAt,
      score: brandUnitInterval(1) as EffectivenessScore, // not yet observed = innocent
    };
  }
  const numerator = matches - reversals - conflictPenalties;
  const raw = numerator / matches;
  const clamped = Math.min(1, Math.max(0, raw));
  return {
    matches,
    reversals,
    conflictPenalties,
    computedAt: input.computedAt,
    score: brandUnitInterval(clamped) as EffectivenessScore,
  };
};

/** Labels used in dashboards. */
export const gradeFor = (
  score: EffectivenessScore,
): 'excellent' | 'strong' | 'fair' | 'weak' | 'failing' => {
  if (score >= 0.95) return 'excellent';
  if (score >= 0.85) return 'strong';
  if (score >= 0.7) return 'fair';
  if (score >= 0.5) return 'weak';
  return 'failing';
};

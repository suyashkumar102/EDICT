import { brandUnitInterval, type UnitInterval } from '@shared/types/BrandedPrimitives';

/**
 * ConfidenceScore is the compiler's certainty that a parsed rule matches the
 * moderator's intent. It is *also* reused by AdaptiveShadowPolicy to mean
 * "post-observation confidence" — false-positive-rate-adjusted certainty that
 * the rule is safe to promote out of shadow mode.
 *
 * Why one type for both: collapsing these into one branded type forces the
 * presentation layer to label them (`compiler confidence`, `runtime confidence`)
 * — we never want them mixed. Static analysis catches confusion at the
 * boundary, not inside the type.
 */
export type ConfidenceScore = UnitInterval & { readonly __score: 'ConfidenceScore' };

export const buildConfidence = (raw: number): ConfidenceScore => {
  return brandUnitInterval(raw) as ConfidenceScore;
};

/** Bayesian-style posterior update given a prior, evidence count, and consistency rate. */
export const updateConfidence = (
  prior: ConfidenceScore,
  observations: number,
  successRate: ConfidenceScore,
): ConfidenceScore => {
  // Weighted blend: prior anchors when n is small, evidence dominates when n grows.
  // The 25 in the denominator is the "minimum observations for adaptive promotion"
  // default in devvit.json; keep them aligned.
  const weight = observations / (observations + 25);
  const blended = prior * (1 - weight) + successRate * weight;
  return buildConfidence(Math.min(1, Math.max(0, blended)));
};

export const isPromotable = (score: ConfidenceScore, threshold: ConfidenceScore): boolean =>
  score >= threshold;

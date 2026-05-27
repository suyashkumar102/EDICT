import type { TimestampMs } from '@shared/types/BrandedPrimitives';
import { brandTimestampMs } from '@shared/types/BrandedPrimitives';
import type { ConfidenceScore } from '@domain/values/ConfidenceScore';
import { buildConfidence } from '@domain/values/ConfidenceScore';

/**
 * Adaptive shadow promotion — the heart of EDICT's safe-rollout story.
 *
 * The idea: shadow mode exists to give moderators a chance to override the
 * rule on real (or simulated) decisions before it goes live. A rule that's
 * been correct on a few hundred posts is more trustworthy than a rule that's
 * been correct on five posts for 24 h.
 *
 * Inputs:
 *   - observations:       how many shadow decisions the rule has produced
 *   - shadowReversals:    how many of those a mod would have overridden
 *   - timeInShadowMs:     how long the rule has been in shadow
 *   - threshold:          confidence cutoff to promote (default 0.92)
 *   - minObservations:    floor on n before adaptive promotion can fire
 *   - hardCapMs:          fallback time-cap if adaptive never trips
 *
 * Output:
 *   - shouldPromote, reason, confidence
 *
 * Math: confidence = (obs - reversals) / max(obs, 1), Laplace-smoothed.
 *   posteriorRate = (obs - reversals + 1) / (obs + 2)
 * Smoothing avoids "10/10 = 100% confidence after one good day" pathology.
 */

export interface AdaptivePromotionInput {
  readonly observations: number;
  readonly shadowReversals: number;
  readonly enteredShadowAt: TimestampMs;
  readonly threshold: ConfidenceScore;
  readonly minObservations: number;
  readonly hardCapMs: number;
  readonly now: TimestampMs;
}

export type AdaptiveReason =
  | 'insufficient-observations'
  | 'confidence-below-threshold'
  | 'reversal-rate-too-high'
  | 'adaptive-confidence'
  | 'time-cap';

export interface AdaptivePromotionDecision {
  readonly shouldPromote: boolean;
  readonly reason: AdaptiveReason;
  readonly confidence: ConfidenceScore;
}

export const decidePromotion = (input: AdaptivePromotionInput): AdaptivePromotionDecision => {
  const {
    observations,
    shadowReversals,
    enteredShadowAt,
    threshold,
    minObservations,
    hardCapMs,
    now,
  } = input;

  const positives = Math.max(0, observations - shadowReversals);
  const smoothedRate = (positives + 1) / (observations + 2); // Laplace smoothing
  const confidence = buildConfidence(smoothedRate);
  const timeInShadow = now - enteredShadowAt;

  // Reversal rate too high: even time-cap won't promote. Bail to manual review.
  const reversalRate = observations === 0 ? 0 : shadowReversals / observations;
  if (reversalRate > 0.25) {
    return { shouldPromote: false, reason: 'reversal-rate-too-high', confidence };
  }

  if (observations < minObservations) {
    if (timeInShadow >= hardCapMs) {
      // Hard cap reached without enough data — still promote, but flag the reason.
      return { shouldPromote: true, reason: 'time-cap', confidence };
    }
    return { shouldPromote: false, reason: 'insufficient-observations', confidence };
  }

  if (confidence >= threshold) {
    return { shouldPromote: true, reason: 'adaptive-confidence', confidence };
  }

  if (timeInShadow >= hardCapMs) {
    return { shouldPromote: true, reason: 'time-cap', confidence };
  }

  return { shouldPromote: false, reason: 'confidence-below-threshold', confidence };
};

export const computeRolloutTimestamp = (now: TimestampMs, fromMs: number): TimestampMs =>
  brandTimestampMs(now + fromMs);

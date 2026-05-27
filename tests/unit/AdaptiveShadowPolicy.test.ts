import { describe, expect, it } from 'vitest';
import { decidePromotion } from '@domain/policies/AdaptiveShadowPolicy';
import { buildConfidence } from '@domain/values/ConfidenceScore';
import { brandTimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Adaptive shadow promotion — the single most important policy in the
 * safety layer. These tests pin down every branch of the decision tree.
 */

const THRESHOLD = buildConfidence(0.92);
const MIN_OBS = 25;
const HARD_CAP_MS = 72 * 60 * 60 * 1000;

const baseInput = {
  threshold: THRESHOLD,
  minObservations: MIN_OBS,
  hardCapMs: HARD_CAP_MS,
};

describe('AdaptiveShadowPolicy.decidePromotion', () => {
  it('holds when observations are below the floor and time-cap not reached', () => {
    const decision = decidePromotion({
      ...baseInput,
      observations: 10,
      shadowReversals: 0,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(60 * 60 * 1000),
    });
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toBe('insufficient-observations');
  });

  it('promotes adaptively once confidence ≥ threshold and minObs reached', () => {
    const decision = decidePromotion({
      ...baseInput,
      observations: 30,
      shadowReversals: 1,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(2 * 60 * 60 * 1000),
    });
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toBe('adaptive-confidence');
    expect(decision.confidence).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it('holds when confidence is below threshold even with enough observations', () => {
    const decision = decidePromotion({
      ...baseInput,
      observations: 30,
      shadowReversals: 6,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(2 * 60 * 60 * 1000),
    });
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toBe('confidence-below-threshold');
  });

  it('refuses to promote when reversal rate exceeds 25% — even at time cap', () => {
    const decision = decidePromotion({
      ...baseInput,
      observations: 100,
      shadowReversals: 35,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(HARD_CAP_MS + 60 * 1000),
    });
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toBe('reversal-rate-too-high');
  });

  it('falls back to time-cap promotion when adaptive never trips but reversals are low', () => {
    const decision = decidePromotion({
      ...baseInput,
      observations: 30,
      shadowReversals: 4,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(HARD_CAP_MS + 60 * 1000),
    });
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toBe('time-cap');
  });

  it('uses Laplace smoothing — 10/10 perfect run does NOT yield 1.0 confidence', () => {
    const decision = decidePromotion({
      ...baseInput,
      observations: 10,
      shadowReversals: 0,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(60 * 60 * 1000),
    });
    expect(decision.confidence).toBeLessThan(1);
    expect(decision.confidence).toBeGreaterThan(0.85);
  });

  it('confidence is monotone in successful observations', () => {
    const lower = decidePromotion({
      ...baseInput,
      observations: 30,
      shadowReversals: 5,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(60 * 60 * 1000),
    });
    const higher = decidePromotion({
      ...baseInput,
      observations: 30,
      shadowReversals: 1,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(60 * 60 * 1000),
    });
    expect(higher.confidence).toBeGreaterThan(lower.confidence);
  });
});

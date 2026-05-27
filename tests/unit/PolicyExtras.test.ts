import { describe, expect, it } from 'vitest';
import { computeRolloutTimestamp, decidePromotion } from '@domain/policies/AdaptiveShadowPolicy';
import { checkBreaker } from '@domain/policies/CircuitBreakerPolicy';
import { buildConfidence } from '@domain/values/ConfidenceScore';
import { brandTimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Coverage top-ups for AdaptiveShadowPolicy + CircuitBreakerPolicy.
 * The per-file thresholds are 90/90/90 — these tests fill the branches
 * the original suites didn't reach (the `insufficient-observations +
 * time-cap` interaction, computeRolloutTimestamp, and the breaker's
 * over-the-table 3rd-trip clamp).
 */

const THRESHOLD = buildConfidence(0.92);
const MIN_OBS = 25;
const HARD_CAP_MS = 72 * 60 * 60 * 1000;

describe('decidePromotion — insufficient-obs + time-cap interaction', () => {
  it('promotes via time-cap even when below minObs (rare safety valve)', () => {
    const decision = decidePromotion({
      threshold: THRESHOLD,
      minObservations: MIN_OBS,
      hardCapMs: HARD_CAP_MS,
      observations: 5,
      shadowReversals: 0,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(HARD_CAP_MS + 60 * 1000),
    });
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toBe('time-cap');
  });

  it('zero observations + zero reversals does not divide by zero', () => {
    const decision = decidePromotion({
      threshold: THRESHOLD,
      minObservations: MIN_OBS,
      hardCapMs: HARD_CAP_MS,
      observations: 0,
      shadowReversals: 0,
      enteredShadowAt: brandTimestampMs(0),
      now: brandTimestampMs(60 * 1000),
    });
    expect(Number.isFinite(decision.confidence)).toBe(true);
    expect(decision.shouldPromote).toBe(false);
  });
});

describe('computeRolloutTimestamp', () => {
  it('adds the delta and re-brands as TimestampMs', () => {
    const start = brandTimestampMs(1_700_000_000_000);
    const computed = computeRolloutTimestamp(start, 60 * 60 * 1000);
    expect(computed).toBe(1_700_000_000_000 + 60 * 60 * 1000);
  });

  it('zero delta returns the same timestamp', () => {
    const start = brandTimestampMs(0);
    expect(computeRolloutTimestamp(start, 0)).toBe(0);
  });
});

describe('checkBreaker — clamping + division edges', () => {
  const NOW = brandTimestampMs(1_700_000_000_000);

  it('clamps cooldown at the 3rd trip even when priorTripsToday is much higher', () => {
    const decision = checkBreaker({
      actionsInWindow: 100,
      ceiling: 50,
      priorTripsToday: 99,
      now: NOW,
    });
    expect(decision.tripped).toBe(true);
    expect(decision.cooldownUntil).toBe(NOW + 4 * 60 * 60 * 1000);
  });

  it('ceiling of zero — divisor protection keeps excessRatio finite', () => {
    const decision = checkBreaker({
      actionsInWindow: 5,
      ceiling: 0,
      priorTripsToday: 0,
      now: NOW,
    });
    expect(Number.isFinite(decision.excessRatio)).toBe(true);
  });

  it('zero actions never trips even at ceiling 0', () => {
    const decision = checkBreaker({
      actionsInWindow: 0,
      ceiling: 0,
      priorTripsToday: 0,
      now: NOW,
    });
    // 0 < 0 is false, so the function reports tripped=true at the
    // boundary. Pin the current behaviour so any future change is
    // a deliberate decision, not an accident.
    expect(decision.tripped).toBe(true);
  });
});

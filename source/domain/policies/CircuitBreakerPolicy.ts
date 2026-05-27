import type { TimestampMs } from '@shared/types/BrandedPrimitives';
import { brandTimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Two-tier circuit breaker. A rule's hourly action count and the subreddit's
 * total hourly action count are both checked at every action site. If either
 * exceeds its configured ceiling, the breaker trips and the rule (or all
 * rules) enter `paused` for a cooldown period.
 *
 * Cooldown scales with trip recurrence: 15 min for the first trip in a day,
 * 1 h for the second, 4 h for the third or more — to avoid flapping where
 * a sub keeps hammering a rule that's truly broken.
 */

export interface BreakerCheckInput {
  readonly actionsInWindow: number;
  readonly ceiling: number;
  readonly priorTripsToday: number;
  readonly now: TimestampMs;
}

export interface BreakerDecision {
  readonly tripped: boolean;
  readonly cooldownUntil: TimestampMs | null;
  readonly excessRatio: number; // (actions / ceiling)
}

const COOLDOWN_MS_BY_TRIP_INDEX = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000];

export const checkBreaker = (input: BreakerCheckInput): BreakerDecision => {
  const ratio = input.actionsInWindow / Math.max(1, input.ceiling);
  if (input.actionsInWindow < input.ceiling) {
    return { tripped: false, cooldownUntil: null, excessRatio: ratio };
  }
  const tripIndex = Math.min(input.priorTripsToday, COOLDOWN_MS_BY_TRIP_INDEX.length - 1);
  const cooldownMs = COOLDOWN_MS_BY_TRIP_INDEX[tripIndex] ?? 4 * 60 * 60 * 1000;
  return {
    tripped: true,
    cooldownUntil: brandTimestampMs(input.now + cooldownMs),
    excessRatio: ratio,
  };
};

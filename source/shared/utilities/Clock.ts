import { brandTimestampMs, type TimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Time is an injected dependency, never read directly from `Date.now()` inside
 * domain or evaluation code. This makes every time-sensitive test trivial and
 * makes the event-replay tool deterministic.
 */
export interface Clock {
  readonly now: () => TimestampMs;
}

export const systemClock: Clock = {
  now: () => brandTimestampMs(Date.now()),
};

export const fixedClock = (ms: number): Clock => ({
  now: () => brandTimestampMs(ms),
});

export const advancingClock = (startMs: number, stepMs = 1): Clock => {
  let current = startMs;
  return {
    now: () => {
      const value = current;
      current += stepMs;
      return brandTimestampMs(value);
    },
  };
};

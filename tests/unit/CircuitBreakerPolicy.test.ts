import { describe, expect, it } from 'vitest';
import { checkBreaker } from '@domain/policies/CircuitBreakerPolicy';
import { brandTimestampMs } from '@shared/types/BrandedPrimitives';

describe('CircuitBreakerPolicy.checkBreaker', () => {
  const NOW = brandTimestampMs(1_700_000_000_000);

  it('does not trip when actions are under the ceiling', () => {
    const decision = checkBreaker({
      actionsInWindow: 10,
      ceiling: 50,
      priorTripsToday: 0,
      now: NOW,
    });
    expect(decision.tripped).toBe(false);
    expect(decision.cooldownUntil).toBeNull();
  });

  it('trips at exactly the ceiling', () => {
    const decision = checkBreaker({
      actionsInWindow: 50,
      ceiling: 50,
      priorTripsToday: 0,
      now: NOW,
    });
    expect(decision.tripped).toBe(true);
    expect(decision.cooldownUntil).not.toBeNull();
  });

  it('first trip cools down 15 minutes', () => {
    const decision = checkBreaker({
      actionsInWindow: 60,
      ceiling: 50,
      priorTripsToday: 0,
      now: NOW,
    });
    expect(decision.cooldownUntil).toBe(NOW + 15 * 60 * 1000);
  });

  it('second trip extends cooldown to 1 hour', () => {
    const decision = checkBreaker({
      actionsInWindow: 60,
      ceiling: 50,
      priorTripsToday: 1,
      now: NOW,
    });
    expect(decision.cooldownUntil).toBe(NOW + 60 * 60 * 1000);
  });

  it('third or later trip extends cooldown to 4 hours', () => {
    const decision = checkBreaker({
      actionsInWindow: 60,
      ceiling: 50,
      priorTripsToday: 5,
      now: NOW,
    });
    expect(decision.cooldownUntil).toBe(NOW + 4 * 60 * 60 * 1000);
  });

  it('excessRatio reflects how badly the ceiling was breached', () => {
    expect(
      checkBreaker({ actionsInWindow: 100, ceiling: 50, priorTripsToday: 0, now: NOW }).excessRatio,
    ).toBe(2);
    expect(
      checkBreaker({ actionsInWindow: 25, ceiling: 50, priorTripsToday: 0, now: NOW }).excessRatio,
    ).toBe(0.5);
  });
});

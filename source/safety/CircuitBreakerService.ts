import type { RuleId, SubredditId, TimestampMs } from '@shared/types/BrandedPrimitives';
import { brandTimestampMs } from '@shared/types/BrandedPrimitives';
import { checkBreaker } from '@domain/policies/CircuitBreakerPolicy';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import {
  breakerRuleHourKey,
  breakerSubHourKey,
  breakerTripsTodayKey,
  dayBucket,
  hourBucket,
} from '@infrastructure/redis/KeyNamespacing';
import { mintUlid } from '@shared/utilities/Ulid';
import type { Clock } from '@shared/utilities/Clock';
import { CircuitBreakerOpen } from '@shared/errors/DomainError';

/**
 * Two-tier circuit breaker:
 *   - per-rule hourly action ceiling (default: 50)
 *   - subreddit-wide hourly action ceiling (default: 200)
 *
 * Both counters are kept in Redis with 90 min TTL — long enough to cover
 * a 1 h window plus skew, short enough that stale data evaporates.
 *
 * When either ceiling is hit:
 *   1. Emit CircuitBreakerTripped (logged in audit)
 *   2. Persist `tripUntil` on the rule's aggregate (via the event projection)
 *   3. Throw CircuitBreakerOpen on subsequent actions until cooldown elapses
 *
 * Cooldown grows with same-day recurrence — see CircuitBreakerPolicy.
 *
 * Why a service (not just inline policy checks): the breaker has *side
 * effects* — incrementing counters, persisting trip records, emitting
 * events — that need to happen exactly once per action attempt, regardless
 * of which rule fired. Centralising avoids duplicate increments when
 * multiple clauses of the same rule cascade.
 */

export interface BreakerGuardInput {
  readonly subreddit: SubredditId;
  readonly ruleId: RuleId;
  readonly ruleCeiling: number;
  readonly subCeiling: number;
  readonly now: TimestampMs;
}

export const buildCircuitBreakerService = (deps: {
  readonly redis: RedisGateway;
  readonly events: EventStore;
  readonly clock: Clock;
}) => {
  const guard = async (input: BreakerGuardInput): Promise<void> => {
    const ruleHourKey = breakerRuleHourKey(input.ruleId, hourBucket(input.now));
    const subHourKey = breakerSubHourKey(input.subreddit, hourBucket(input.now));
    const tripsKey = breakerTripsTodayKey(input.subreddit, dayBucket(input.now));

    const ruleCount = await deps.redis.incr(ruleHourKey);
    await deps.redis.expire(ruleHourKey, 90 * 60);
    const subCount = await deps.redis.incr(subHourKey);
    await deps.redis.expire(subHourKey, 90 * 60);

    const ruleDecision = checkBreaker({
      actionsInWindow: ruleCount,
      ceiling: input.ruleCeiling,
      priorTripsToday: Number(await deps.redis.get(tripsKey)) || 0,
      now: input.now,
    });
    const subDecision = checkBreaker({
      actionsInWindow: subCount,
      ceiling: input.subCeiling,
      priorTripsToday: Number(await deps.redis.get(tripsKey)) || 0,
      now: input.now,
    });

    if (ruleDecision.tripped) {
      await deps.redis.incr(tripsKey);
      await deps.redis.expire(tripsKey, 26 * 60 * 60);
      const cooldown = ruleDecision.cooldownUntil ?? brandTimestampMs(input.now + 15 * 60 * 1000);
      await deps.events.append({
        eventId: mintUlid(() => input.now),
        subreddit: input.subreddit,
        occurredAt: input.now,
        actor: 'system',
        payload: {
          kind: 'CircuitBreakerTripped',
          scope: 'rule',
          ruleId: input.ruleId,
          actionsInWindow: ruleCount,
          ceiling: input.ruleCeiling,
          cooldownUntil: cooldown,
        },
      });
      throw new CircuitBreakerOpen('rule', cooldown);
    }

    if (subDecision.tripped) {
      await deps.redis.incr(tripsKey);
      await deps.redis.expire(tripsKey, 26 * 60 * 60);
      const cooldown = subDecision.cooldownUntil ?? brandTimestampMs(input.now + 15 * 60 * 1000);
      await deps.events.append({
        eventId: mintUlid(() => input.now),
        subreddit: input.subreddit,
        occurredAt: input.now,
        actor: 'system',
        payload: {
          kind: 'CircuitBreakerTripped',
          scope: 'subreddit',
          ruleId: null,
          actionsInWindow: subCount,
          ceiling: input.subCeiling,
          cooldownUntil: cooldown,
        },
      });
      throw new CircuitBreakerOpen('subreddit', cooldown);
    }
  };

  const inspect = async (input: { subreddit: SubredditId; ruleId: RuleId; now: TimestampMs }) => {
    const ruleHourKey = breakerRuleHourKey(input.ruleId, hourBucket(input.now));
    const subHourKey = breakerSubHourKey(input.subreddit, hourBucket(input.now));
    return {
      ruleActionsInHour: Number(await deps.redis.get(ruleHourKey)) || 0,
      subActionsInHour: Number(await deps.redis.get(subHourKey)) || 0,
    };
  };

  return { guard, inspect };
};

export type CircuitBreakerService = ReturnType<typeof buildCircuitBreakerService>;

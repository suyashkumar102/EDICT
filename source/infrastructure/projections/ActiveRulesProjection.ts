import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';
import { isActive } from '@domain/aggregates/RuleAggregate';
import { apply } from '@domain/aggregates/RuleAggregateProjection';
import type { DomainEvent } from '@domain/events/DomainEvent';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { activeRulesKey } from '@infrastructure/redis/KeyNamespacing';
import type { RuleId, SubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Idempotent projection: given the canonical event log, rebuild the
 * "currently active rules" view. Reads either:
 *   - the cached snapshot hash (fast path)
 *   - replay from the event log (cold start, time-travel)
 *
 * The cached hash is updated incrementally by the event dispatcher: every
 * time a domain event is appended, we re-apply it to the affected rule
 * aggregate and write back.
 */

export interface ActiveRulesView {
  readonly rules: readonly RuleAggregate[];
}

export const buildActiveRulesProjection = (redis: RedisGateway) => ({
  /**
   * Apply one event to the cached snapshot. Called by the event dispatcher
   * after every append.
   */
  applyEvent: async (event: DomainEvent): Promise<void> => {
    if (!('ruleId' in event.payload)) return;
    const ruleId = (event.payload as { ruleId: RuleId }).ruleId;
    const key = activeRulesKey(event.subreddit);
    const previousJson = await redis.hget(key, ruleId);
    const previous = previousJson ? (JSON.parse(previousJson) as RuleAggregate) : null;
    const next = apply(previous, event);
    if (next) {
      await redis.hset(key, ruleId, JSON.stringify(next));
    }
  },

  /**
   * Read all aggregates and filter to the active ones.
   */
  readActive: async (subreddit: SubredditId): Promise<ActiveRulesView> => {
    const key = activeRulesKey(subreddit);
    const all = await redis.hgetall(key);
    const aggregates = Object.values(all)
      .map((json) => JSON.parse(json) as RuleAggregate)
      .filter(isActive);
    return { rules: aggregates };
  },

  /**
   * Read a specific aggregate, including paused/archived (for diff views).
   */
  readById: async (subreddit: SubredditId, ruleId: RuleId): Promise<RuleAggregate | null> => {
    const key = activeRulesKey(subreddit);
    const json = await redis.hget(key, ruleId);
    return json ? (JSON.parse(json) as RuleAggregate) : null;
  },

  /**
   * Drop the cached snapshot. Used by the event-store-compaction job
   * before a full rebuild from the event log.
   */
  invalidate: async (subreddit: SubredditId): Promise<void> => {
    await redis.del(activeRulesKey(subreddit));
  },

  /**
   * Cold rebuild from the event log. Bounded by `events.length`. The
   * scheduler calls this if it detects projection drift via checksum.
   */
  rebuildFromEvents: async (
    subreddit: SubredditId,
    events: readonly DomainEvent[],
  ): Promise<number> => {
    await redis.del(activeRulesKey(subreddit));
    const perRule = new Map<RuleId, RuleAggregate | null>();
    for (const e of events) {
      if (!('ruleId' in e.payload)) continue;
      const id = (e.payload as { ruleId: RuleId }).ruleId;
      perRule.set(id, apply(perRule.get(id) ?? null, e));
    }
    let written = 0;
    for (const [id, agg] of perRule.entries()) {
      if (agg) {
        await redis.hset(activeRulesKey(subreddit), id, JSON.stringify(agg));
        written += 1;
      }
    }
    return written;
  },
});

export type ActiveRulesProjection = ReturnType<typeof buildActiveRulesProjection>;

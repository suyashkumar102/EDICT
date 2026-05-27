import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { briefingFeedKey } from '@infrastructure/redis/KeyNamespacing';
import type { RuleId, SubredditId, TimestampMs } from '@shared/types/BrandedPrimitives';
import type { BriefingPrepared } from '@domain/events/DomainEvent';

/**
 * Briefing feed projection. Stores hourly briefing snapshots in a capped
 * list (Redis RPUSH + LTRIM at 50). The Command Center reads these
 * directly to render the "What happened since your last visit?" timeline.
 *
 * Why a list, not a ZSet: briefings are time-ordered, contiguous, and we
 * always read the newest N. A list with LTRIM is the simplest correct
 * shape; we don't need range-by-score queries.
 */

export interface BriefingSnapshot {
  readonly windowStart: TimestampMs;
  readonly windowEnd: TimestampMs;
  readonly actionsTaken: number;
  readonly shadowDecisions: number;
  readonly reversals: number;
  readonly anomalies: readonly string[];
  readonly topRules: readonly { ruleId: RuleId; matchCount: number }[];
}

const MAX_RETAINED = 50;

export const buildBriefingFeed = (redis: RedisGateway) => ({
  append: async (subreddit: SubredditId, briefing: BriefingPrepared): Promise<void> => {
    const snapshot: BriefingSnapshot = {
      windowStart: briefing.windowStart,
      windowEnd: briefing.windowEnd,
      actionsTaken: briefing.actionsTaken,
      shadowDecisions: briefing.shadowDecisions,
      reversals: briefing.reversals,
      anomalies: briefing.anomalies,
      topRules: briefing.topRules,
    };
    await redis.rpush(briefingFeedKey(subreddit), JSON.stringify(snapshot));
    await redis.ltrim(briefingFeedKey(subreddit), -MAX_RETAINED, -1);
  },

  readLatest: async (subreddit: SubredditId, n: number): Promise<readonly BriefingSnapshot[]> => {
    const items = await redis.lrange(briefingFeedKey(subreddit), -n, -1);
    return items.map((s) => JSON.parse(s) as BriefingSnapshot).reverse();
  },

  readSince: async (
    subreddit: SubredditId,
    since: TimestampMs,
  ): Promise<readonly BriefingSnapshot[]> => {
    const all = await redis.lrange(briefingFeedKey(subreddit), 0, -1);
    return all
      .map((s) => JSON.parse(s) as BriefingSnapshot)
      .filter((b) => b.windowEnd >= since)
      .reverse();
  },
});

export type BriefingFeed = ReturnType<typeof buildBriefingFeed>;

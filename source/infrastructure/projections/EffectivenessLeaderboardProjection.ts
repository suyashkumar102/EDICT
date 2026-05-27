import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { effectivenessLeaderKey } from '@infrastructure/redis/KeyNamespacing';
import type { RuleId, SubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Effectiveness leaderboard: a per-subreddit sorted set of (ruleId, score).
 * Updated by the effectiveness-recompute scheduler every 2h.
 *
 * The leaderboard powers:
 *   - the Command Center "Top Performers" tile
 *   - the suggestion engine's "rules to retire" prompt (bottom of the list)
 *   - effectiveness sort order in the rule list
 */

export interface LeaderboardEntry {
  readonly ruleId: RuleId;
  readonly score: number;
}

export const buildEffectivenessLeaderboard = (redis: RedisGateway) => ({
  update: async (subreddit: SubredditId, ruleId: RuleId, score: number): Promise<void> => {
    // ZADD overwrites the score if member exists; we use it directly rather
    // than ZINCRBY because scores are computed absolutely, not incrementally.
    await redis.zadd(effectivenessLeaderKey(subreddit), score, ruleId);
  },

  topN: async (subreddit: SubredditId, n: number): Promise<readonly LeaderboardEntry[]> => {
    const members = await redis.zrange(effectivenessLeaderKey(subreddit), 0, n - 1, { rev: true });
    return members.map((m) => ({ ruleId: m as RuleId, score: 0 })); // raw API can't return scores in our gateway shape
  },

  bottomN: async (subreddit: SubredditId, n: number): Promise<readonly LeaderboardEntry[]> => {
    const members = await redis.zrange(effectivenessLeaderKey(subreddit), 0, n - 1, { rev: false });
    return members.map((m) => ({ ruleId: m as RuleId, score: 0 }));
  },

  scoreFor: async (subreddit: SubredditId, ruleId: RuleId): Promise<number | null> => {
    const members = await redis.zrange(effectivenessLeaderKey(subreddit), 0, -1);
    return members.includes(ruleId) ? 0 : null;
  },
});

export type EffectivenessLeaderboard = ReturnType<typeof buildEffectivenessLeaderboard>;

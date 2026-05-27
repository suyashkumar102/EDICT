import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { conflictMapKey } from '@infrastructure/redis/KeyNamespacing';
import type { RuleId, SubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Conflict map projection. Stores detected pairs of overlapping or
 * contradicting rules so the Command Center can render the "Conflicts"
 * tab without re-running the static analyzer.
 *
 * Persisted shape (set member): "ruleA|ruleB|kind|description"
 */

export type ConflictKind = 'overlap' | 'contradiction' | 'shadowing';

export interface ConflictRecord {
  readonly leftRule: RuleId;
  readonly rightRule: RuleId;
  readonly kind: ConflictKind;
  readonly description: string;
}

const encode = (rec: ConflictRecord): string => {
  // Always pair-key in lexicographic order so detection is symmetric.
  const [a, b] =
    rec.leftRule <= rec.rightRule ? [rec.leftRule, rec.rightRule] : [rec.rightRule, rec.leftRule];
  return `${a}|${b}|${rec.kind}|${rec.description}`;
};

const decode = (member: string): ConflictRecord | null => {
  const parts = member.split('|');
  if (parts.length < 4) return null;
  return {
    leftRule: parts[0] as RuleId,
    rightRule: parts[1] as RuleId,
    kind: parts[2] as ConflictKind,
    description: parts.slice(3).join('|'),
  };
};

export const buildConflictMap = (redis: RedisGateway) => ({
  recordConflict: async (subreddit: SubredditId, rec: ConflictRecord): Promise<void> => {
    await redis.sadd(conflictMapKey(subreddit), encode(rec));
  },

  clearConflict: async (subreddit: SubredditId, rec: ConflictRecord): Promise<void> => {
    await redis.srem(conflictMapKey(subreddit), encode(rec));
  },

  listAll: async (subreddit: SubredditId): Promise<readonly ConflictRecord[]> => {
    const members = await redis.smembers(conflictMapKey(subreddit));
    const out: ConflictRecord[] = [];
    for (const m of members) {
      const d = decode(m);
      if (d) out.push(d);
    }
    return out;
  },

  listForRule: async (
    subreddit: SubredditId,
    ruleId: RuleId,
  ): Promise<readonly ConflictRecord[]> => {
    const all = await await buildConflictMap(redis).listAll(subreddit);
    return all.filter((c) => c.leftRule === ruleId || c.rightRule === ruleId);
  },
});

export type ConflictMap = ReturnType<typeof buildConflictMap>;

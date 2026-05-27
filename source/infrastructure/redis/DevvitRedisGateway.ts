import { redis as devvitRedis } from '@devvit/web/server';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';

/**
 * Production RedisGateway over Devvit's hosted Redis (`@devvit/web/server`).
 *
 * Devvit's Redis surface is a deliberate subset of the full protocol — it
 * exposes strings, hashes, sorted sets, transactions, and number ops, but
 * has NO native list or set commands and uses camelCase method names with
 * a `{ score, member }` shape for sorted-set entries. This adapter is the
 * single boundary that absorbs that impedance:
 *
 *   - Set semantics (sadd/srem/smembers) are emulated on a sorted set with
 *     a constant score of 0; membership is by `member` string.
 *
 *   - List semantics (rpush/lrange/ltrim) are emulated on a sorted set with
 *     a monotonically increasing score derived from a per-key counter held
 *     in a sibling string key. Negative indexes are resolved via `zCard` so
 *     `lrange(key, -50, -1)` behaves like a native Redis list.
 *
 *   - String TTLs use `expiration: Date` (Devvit's idiom). The gateway
 *     interface speaks seconds, so we translate.
 *
 *   - `incr` becomes `incrBy(key, 1)` since Devvit only ships the by-N form.
 *
 * The in-memory gateway in RedisGateway.ts keeps the same contract, so
 * tests stay deterministic and offline.
 */

const LIST_CURSOR_KEY = (key: string): string => `${key}::__cursor`;

const toMembers = (entries: readonly { member: string; score: number }[]): string[] =>
  entries.map((e) => e.member);

const resolveListIndex = async (key: string, index: number): Promise<number> => {
  if (index >= 0) return index;
  const card = await devvitRedis.zCard(key);
  return Math.max(0, card + index);
};

export const buildDevvitRedisGateway = (): RedisGateway => ({
  async get(key) {
    const v = await devvitRedis.get(key);
    return v ?? null;
  },

  async set(key, value, opts) {
    if (opts?.ttlSeconds) {
      await devvitRedis.set(key, value, {
        expiration: new Date(Date.now() + opts.ttlSeconds * 1000),
      });
      return;
    }
    await devvitRedis.set(key, value);
  },

  async del(key) {
    await devvitRedis.del(key);
    await devvitRedis.del(LIST_CURSOR_KEY(key));
  },

  async incr(key) {
    return devvitRedis.incrBy(key, 1);
  },

  async expire(key, seconds) {
    await devvitRedis.expire(key, seconds);
  },

  async hset(key, field, value) {
    await devvitRedis.hSet(key, { [field]: value });
  },

  async hget(key, field) {
    const v = await devvitRedis.hGet(key, field);
    return v ?? null;
  },

  async hdel(key, field) {
    await devvitRedis.hDel(key, [field]);
  },

  async hgetall(key) {
    const raw = await devvitRedis.hGetAll(key);
    return raw ?? {};
  },

  async zadd(key, score, member) {
    await devvitRedis.zAdd(key, { member, score });
  },

  async zrange(key, start, stop, opts) {
    const entries = await devvitRedis.zRange(key, start, stop, {
      by: 'rank',
      reverse: opts?.rev ?? false,
    });
    return toMembers(entries);
  },

  async zrangeByScore(key, min, max, opts) {
    const entries = await devvitRedis.zRange(key, min, max, {
      by: 'score',
      ...(opts?.limit ? { limit: { offset: 0, count: opts.limit } } : {}),
    });
    return toMembers(entries);
  },

  async zremRangeByScore(key, min, max) {
    return devvitRedis.zRemRangeByScore(key, min, max);
  },

  async zincrby(key, increment, member) {
    return devvitRedis.zIncrBy(key, member, increment);
  },

  async zcard(key) {
    return devvitRedis.zCard(key);
  },

  async sadd(key, member) {
    await devvitRedis.zAdd(key, { member, score: 0 });
  },

  async smembers(key) {
    const entries = await devvitRedis.zRange(key, 0, -1, { by: 'rank' });
    return toMembers(entries);
  },

  async srem(key, member) {
    await devvitRedis.zRem(key, [member]);
  },

  async rpush(key, value) {
    const score = await devvitRedis.incrBy(LIST_CURSOR_KEY(key), 1);
    await devvitRedis.zAdd(key, { member: value, score });
  },

  async lrange(key, start, stop) {
    const lo = await resolveListIndex(key, start);
    const hi = stop === -1 ? -1 : await resolveListIndex(key, stop);
    const entries = await devvitRedis.zRange(key, lo, hi, { by: 'rank' });
    return toMembers(entries);
  },

  async ltrim(key, start, stop) {
    const card = await devvitRedis.zCard(key);
    if (card === 0) return;
    const lo = start >= 0 ? start : Math.max(0, card + start);
    const hi = stop === -1 ? card - 1 : stop >= 0 ? stop : Math.max(0, card + stop);
    if (hi < card - 1) {
      await devvitRedis.zRemRangeByRank(key, hi + 1, card - 1);
    }
    if (lo > 0) {
      await devvitRedis.zRemRangeByRank(key, 0, lo - 1);
    }
  },
});

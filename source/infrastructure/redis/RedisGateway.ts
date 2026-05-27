/**
 * Thin port around the subset of Redis operations EDICT actually uses.
 *
 * Why not depend on the Devvit Redis API directly: tests run without a
 * Devvit runtime, replay tooling is offline, and the event store wants a
 * stable surface to mock. This port + InMemoryRedisGateway combination
 * lets every test be in-process and deterministic.
 */
export interface RedisGateway {
  // strings
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;

  // hashes
  hset(key: string, field: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;

  // sorted sets
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(key: string, start: number, stop: number, opts?: { rev?: boolean }): Promise<string[]>;
  zrangeByScore(
    key: string,
    min: number,
    max: number,
    opts?: { limit?: number },
  ): Promise<string[]>;
  zremRangeByScore(key: string, min: number, max: number): Promise<number>;
  zincrby(key: string, increment: number, member: string): Promise<number>;
  zcard(key: string): Promise<number>;

  // sets
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, member: string): Promise<void>;

  // lists
  rpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
}

/**
 * In-memory implementation used by tests and the offline replay tool.
 * Implements just enough to satisfy the gateway interface; not designed
 * for production traffic.
 */
export const buildInMemoryRedisGateway = (): RedisGateway => {
  const strings = new Map<string, { value: string; expiresAt: number | null }>();
  const hashes = new Map<string, Map<string, string>>();
  const sortedSets = new Map<string, { score: number; member: string }[]>();
  const sets = new Map<string, Set<string>>();
  const lists = new Map<string, string[]>();

  const checkTtl = (key: string): void => {
    const entry = strings.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      strings.delete(key);
    }
  };

  return {
    async get(key) {
      checkTtl(key);
      return strings.get(key)?.value ?? null;
    },
    async set(key, value, opts) {
      strings.set(key, {
        value,
        expiresAt: opts?.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : null,
      });
    },
    async del(key) {
      strings.delete(key);
      hashes.delete(key);
      sortedSets.delete(key);
      sets.delete(key);
      lists.delete(key);
    },
    async incr(key) {
      checkTtl(key);
      const current = parseInt(strings.get(key)?.value ?? '0', 10);
      const next = current + 1;
      strings.set(key, { value: String(next), expiresAt: strings.get(key)?.expiresAt ?? null });
      return next;
    },
    async expire(key, seconds) {
      const entry = strings.get(key);
      if (entry) {
        strings.set(key, { value: entry.value, expiresAt: Date.now() + seconds * 1000 });
      }
    },
    async hset(key, field, value) {
      const h = hashes.get(key) ?? new Map<string, string>();
      h.set(field, value);
      hashes.set(key, h);
    },
    async hget(key, field) {
      return hashes.get(key)?.get(field) ?? null;
    },
    async hdel(key, field) {
      hashes.get(key)?.delete(field);
    },
    async hgetall(key) {
      const h = hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    },
    async zadd(key, score, member) {
      const z = sortedSets.get(key) ?? [];
      const idx = z.findIndex((e) => e.member === member);
      if (idx >= 0) z[idx] = { score, member };
      else z.push({ score, member });
      z.sort((a, b) => a.score - b.score);
      sortedSets.set(key, z);
    },
    async zrange(key, start, stop, opts) {
      const z = sortedSets.get(key) ?? [];
      const sorted = opts?.rev ? [...z].reverse() : z;
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end).map((e) => e.member);
    },
    async zrangeByScore(key, min, max, opts) {
      const z = sortedSets.get(key) ?? [];
      const matches = z.filter((e) => e.score >= min && e.score <= max).map((e) => e.member);
      return opts?.limit ? matches.slice(0, opts.limit) : matches;
    },
    async zremRangeByScore(key, min, max) {
      const z = sortedSets.get(key) ?? [];
      const kept = z.filter((e) => e.score < min || e.score > max);
      sortedSets.set(key, kept);
      return z.length - kept.length;
    },
    async zincrby(key, increment, member) {
      const z = sortedSets.get(key) ?? [];
      const existing = z.find((e) => e.member === member);
      if (existing) {
        existing.score += increment;
        sortedSets.set(
          key,
          [...z].sort((a, b) => a.score - b.score),
        );
        return existing.score;
      }
      z.push({ score: increment, member });
      sortedSets.set(
        key,
        [...z].sort((a, b) => a.score - b.score),
      );
      return increment;
    },
    async zcard(key) {
      return sortedSets.get(key)?.length ?? 0;
    },
    async sadd(key, member) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(member);
      sets.set(key, s);
    },
    async smembers(key) {
      return Array.from(sets.get(key) ?? new Set<string>());
    },
    async srem(key, member) {
      sets.get(key)?.delete(member);
    },
    async rpush(key, value) {
      const l = lists.get(key) ?? [];
      l.push(value);
      lists.set(key, l);
    },
    async lrange(key, start, stop) {
      const l = lists.get(key) ?? [];
      const end = stop === -1 ? l.length : stop + 1;
      return l.slice(start, end);
    },
    async ltrim(key, start, stop) {
      const l = lists.get(key) ?? [];
      const end = stop === -1 ? l.length : stop + 1;
      lists.set(key, l.slice(start, end));
    },
  };
};

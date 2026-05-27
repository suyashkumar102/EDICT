import type {
  EventStore,
  ReadBeforeInput,
  ReadWindowInput,
} from '@infrastructure/eventstore/EventStore';
import type { DomainEvent } from '@domain/events/DomainEvent';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { eventLogKey } from '@infrastructure/redis/KeyNamespacing';
import { InfrastructureFailure } from '@shared/errors/DomainError';

/**
 * Production event store. One ZSet per subreddit (event log), scored by
 * `occurredAt`, member = JSON-serialised envelope. ULID inside the
 * envelope guarantees member uniqueness even when two events share a
 * millisecond.
 *
 * Read paths use ZRANGEBYSCORE for time-windowed queries and ZRANGE for
 * "last N" queries. Append is a single ZADD; no read-before-write.
 */
export const buildRedisEventStore = (redis: RedisGateway): EventStore => ({
  append: async (event: DomainEvent) => {
    const key = eventLogKey(event.subreddit);
    const payload = JSON.stringify(event);
    if (payload.length > 64 * 1024) {
      throw new InfrastructureFailure(
        `Event payload exceeds 64KB safety cap: ${event.payload.kind} (${payload.length} bytes)`,
      );
    }
    await redis.zadd(key, event.occurredAt, payload);
  },

  readWindow: async (input: ReadWindowInput) => {
    const key = eventLogKey(input.subreddit);
    const members = await redis.zrangeByScore(
      key,
      input.fromInclusive,
      input.toExclusive - 1,
      input.limit ? { limit: input.limit } : undefined,
    );
    return parseEvents(members);
  },

  readBefore: async (input: ReadBeforeInput) => {
    const key = eventLogKey(input.subreddit);
    const members = await redis.zrangeByScore(
      key,
      Number.NEGATIVE_INFINITY,
      input.beforeExclusive - 1,
      input.limit ? { limit: input.limit } : undefined,
    );
    return parseEvents(members);
  },

  size: async (subreddit) => {
    return redis.zcard(eventLogKey(subreddit));
  },
});

const parseEvents = (members: readonly string[]): readonly DomainEvent[] => {
  const out: DomainEvent[] = [];
  for (const m of members) {
    try {
      out.push(JSON.parse(m) as DomainEvent);
    } catch {
      // skip corrupt entries — they get logged in production
    }
  }
  return out;
};

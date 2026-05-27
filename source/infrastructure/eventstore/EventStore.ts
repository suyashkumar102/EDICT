import type { DomainEvent } from '@domain/events/DomainEvent';
import type { SubredditId, TimestampMs, ULID } from '@shared/types/BrandedPrimitives';

/**
 * EventStore is the immutable, append-only log of every domain event in a
 * subreddit's installation of EDICT. It is the single source of truth.
 *
 * Read patterns supported:
 *   - append a new event (commit)
 *   - read by time window (for projections, audit timeline, briefings)
 *   - read events for a specific rule (filter on payload.ruleId — done in
 *     application layer because the store doesn't know payload shape)
 *   - time-travel: read all events occurring before T (build a historical
 *     RuleAggregate as it was at T)
 *
 * Compaction: we never delete events. The nightly compaction job
 * (scheduler/event-store-compaction) writes a *snapshot* every 5,000
 * events per rule, so replay-from-zero is bounded; the events themselves
 * stay for the configured rollback window plus a 90-day grace tail (to
 * permit retroactive analytics).
 */

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  readWindow(input: ReadWindowInput): Promise<readonly DomainEvent[]>;
  readBefore(input: ReadBeforeInput): Promise<readonly DomainEvent[]>;
  size(subreddit: SubredditId): Promise<number>;
}

export interface ReadWindowInput {
  readonly subreddit: SubredditId;
  readonly fromInclusive: TimestampMs;
  readonly toExclusive: TimestampMs;
  readonly limit?: number;
}

export interface ReadBeforeInput {
  readonly subreddit: SubredditId;
  readonly beforeExclusive: TimestampMs;
  readonly limit?: number;
}

export interface EventStoreSnapshot {
  readonly aggregateId: string;
  readonly atVersion: number;
  readonly atEventId: ULID;
  readonly atTimestamp: TimestampMs;
  readonly serializedState: string;
}

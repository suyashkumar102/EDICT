import type { RuleId, SubredditId, ULID } from '@shared/types/BrandedPrimitives';

/**
 * Single source of truth for Redis key shapes. Everything stored in Devvit's
 * Redis is per-installation (Devvit handles isolation), but we still
 * namespace within that to make `KEYS edict:*` debugging painless and to
 * prevent accidental cross-feature collisions.
 *
 * Key family:
 *   edict:eventlog:{subreddit}              ZSet of EventEnvelope payloads, score=occurredAt
 *   edict:projection:active:{subreddit}     Hash ruleId → JSON(RuleAggregate snapshot)
 *   edict:projection:audit:{subreddit}      ZSet of audit lines, score=occurredAt
 *   edict:projection:effectiveness:{sub}    SortedSet ruleId → score (0..1)
 *   edict:projection:briefing:{sub}         List of JSON briefings (capped at 50)
 *   edict:projection:conflicts:{sub}        Set of "ruleA|ruleB|kind"
 *   edict:rollback:{ulid}                   String (JSON action snapshot), 30-day TTL
 *   edict:breaker:rule:{ruleId}:{hour}      Counter, 90-min TTL
 *   edict:breaker:sub:{subreddit}:{hour}    Counter, 90-min TTL
 *   edict:breaker:trips-today:{subreddit}   Counter, 26-hour TTL
 *   edict:quota:compile:{sub}:{day}         Counter, 26-hour TTL
 *   edict:consensus:{ruleId}                Hash voterId → JSON(vote)
 *   edict:gallery:imported:{sub}            Set of templateSlug
 *   edict:learning:downweight:{sub}         ZSet patternHash → undoCount
 */

export const eventLogKey = (sub: SubredditId): string => `edict:eventlog:${sub}`;

export const activeRulesKey = (sub: SubredditId): string => `edict:projection:active:${sub}`;

export const auditTimelineKey = (sub: SubredditId): string => `edict:projection:audit:${sub}`;

export const effectivenessLeaderKey = (sub: SubredditId): string =>
  `edict:projection:effectiveness:${sub}`;

export const briefingFeedKey = (sub: SubredditId): string => `edict:projection:briefing:${sub}`;

export const conflictMapKey = (sub: SubredditId): string => `edict:projection:conflicts:${sub}`;

export const rollbackTokenKey = (ulid: ULID): string => `edict:rollback:${ulid}`;

export const breakerRuleHourKey = (ruleId: RuleId, hourBucket: number): string =>
  `edict:breaker:rule:${ruleId}:${hourBucket}`;

export const breakerSubHourKey = (sub: SubredditId, hourBucket: number): string =>
  `edict:breaker:sub:${sub}:${hourBucket}`;

export const breakerTripsTodayKey = (sub: SubredditId, dayBucket: number): string =>
  `edict:breaker:trips-today:${sub}:${dayBucket}`;

export const compileQuotaKey = (sub: SubredditId, dayBucket: number): string =>
  `edict:quota:compile:${sub}:${dayBucket}`;

export const consensusKey = (ruleId: RuleId): string => `edict:consensus:${ruleId}`;

export const galleryImportedKey = (sub: SubredditId): string => `edict:gallery:imported:${sub}`;

export const learningDownweightKey = (sub: SubredditId): string =>
  `edict:learning:downweight:${sub}`;

export const hourBucket = (ms: number): number => Math.floor(ms / (60 * 60 * 1000));
export const dayBucket = (ms: number): number => Math.floor(ms / (24 * 60 * 60 * 1000));

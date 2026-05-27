import type { ActionVerdict } from '@domain/values/ActionVerdict';
import { isReversible } from '@domain/values/ActionVerdict';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { rollbackTokenKey } from '@infrastructure/redis/KeyNamespacing';
import type { Clock } from '@shared/utilities/Clock';
import { mintUlid } from '@shared/utilities/Ulid';
import {
  brandTimestampMs,
  type RuleId,
  type ThingId,
  type TimestampMs,
  type ULID,
} from '@shared/types/BrandedPrimitives';
import { RollbackWindowExpired } from '@shared/errors/DomainError';

/**
 * Rollback tokens. Every reversible action persists a token that captures
 * the pre-action state of the thing (post/comment) — enough to restore it
 * if the moderator hits "Reverse this decision" before the TTL elapses.
 *
 * Token TTL = subreddit's `rollbackWindowDays` setting (default 30 days).
 *
 * Why a token, not just an event log entry: the event log says *what*
 * EDICT did; the token captures *what to do to undo it* (e.g. which
 * removal flag to clear, which sticky slot to unpin). Decoupling these
 * keeps the event log lean and the rollback path direct.
 */

export interface RollbackToken {
  readonly tokenId: ULID;
  readonly ruleId: RuleId;
  readonly thingId: ThingId;
  readonly verdict: ActionVerdict;
  readonly takenAt: TimestampMs;
  readonly expiresAt: TimestampMs;
  readonly originalEventId: ULID;
}

export const buildRollbackTokenService = (deps: {
  readonly redis: RedisGateway;
  readonly clock: Clock;
}) => ({
  mint: async (input: {
    readonly ruleId: RuleId;
    readonly thingId: ThingId;
    readonly verdict: ActionVerdict;
    readonly originalEventId: ULID;
    readonly windowDays: number;
  }): Promise<RollbackToken | null> => {
    if (!isReversible(input.verdict)) return null;
    const now = deps.clock.now();
    const expiresAt = brandTimestampMs(now + input.windowDays * 24 * 60 * 60 * 1000);
    const token: RollbackToken = {
      tokenId: mintUlid(() => now),
      ruleId: input.ruleId,
      thingId: input.thingId,
      verdict: input.verdict,
      takenAt: now,
      expiresAt,
      originalEventId: input.originalEventId,
    };
    await deps.redis.set(rollbackTokenKey(token.tokenId), JSON.stringify(token), {
      ttlSeconds: input.windowDays * 24 * 60 * 60,
    });
    return token;
  },

  redeem: async (tokenId: ULID): Promise<RollbackToken> => {
    const raw = await deps.redis.get(rollbackTokenKey(tokenId));
    if (!raw) {
      throw new RollbackWindowExpired(tokenId, deps.clock.now());
    }
    const token = JSON.parse(raw) as RollbackToken;
    if (token.expiresAt < deps.clock.now()) {
      await deps.redis.del(rollbackTokenKey(tokenId));
      throw new RollbackWindowExpired(tokenId, token.expiresAt);
    }
    // Consume — rollback is one-shot.
    await deps.redis.del(rollbackTokenKey(tokenId));
    return token;
  },

  inspect: async (tokenId: ULID): Promise<RollbackToken | null> => {
    const raw = await deps.redis.get(rollbackTokenKey(tokenId));
    if (!raw) return null;
    return JSON.parse(raw) as RollbackToken;
  },
});

export type RollbackTokenService = ReturnType<typeof buildRollbackTokenService>;

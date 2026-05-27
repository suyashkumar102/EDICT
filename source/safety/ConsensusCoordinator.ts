import type { ModeratorId, RuleId } from '@shared/types/BrandedPrimitives';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { consensusKey } from '@infrastructure/redis/KeyNamespacing';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { Clock } from '@shared/utilities/Clock';
import { mintUlid } from '@shared/utilities/Ulid';
import type { ActionKind } from '@domain/values/ActionVerdict';
import type { ConsensusMode } from '@domain/policies/ConsensusPolicy';
import { isSatisfied, requirementFor } from '@domain/policies/ConsensusPolicy';
import { ConsensusRequired } from '@shared/errors/DomainError';
import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';
import type { SubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Coordinates the multi-mod consensus workflow. When a rule is composed
 * and `consensusRequired` is set to risky/strict, the author's activation
 * intent is recorded — the second mod has to vote approve before the
 * RuleActivated event is appended.
 *
 * Storage: one hash per rule, keyed by voter ID. Value is JSON
 * { vote: 'approve' | 'reject', note?: string, votedAt: ms }.
 *
 * Why this isn't a saga: the consensus state changes infrequently and
 * we want to read it cheaply. A simple hash + transition function keeps
 * the protocol legible. The actual ACTIVATION still flows through the
 * normal command/event path; consensus just gates it.
 */

export const buildConsensusCoordinator = (deps: {
  readonly redis: RedisGateway;
  readonly events: EventStore;
  readonly clock: Clock;
}) => ({
  recordVote: async (input: {
    readonly subreddit: SubredditId;
    readonly ruleId: RuleId;
    readonly voter: ModeratorId;
    readonly vote: 'approve' | 'reject';
    readonly note?: string;
  }): Promise<void> => {
    const now = deps.clock.now();
    const payload = JSON.stringify({ vote: input.vote, note: input.note, votedAt: now });
    await deps.redis.hset(consensusKey(input.ruleId), input.voter, payload);
    await deps.events.append({
      eventId: mintUlid(() => now),
      subreddit: input.subreddit,
      occurredAt: now,
      actor: input.voter,
      payload: {
        kind: 'ConsensusVoteCast',
        ruleId: input.ruleId,
        voter: input.voter,
        vote: input.vote,
        ...(input.note ? { note: input.note } : {}),
      },
    });
  },

  /**
   * Read current tally. Returns { approvals, rejections } as voter ID sets.
   */
  readTally: async (
    ruleId: RuleId,
  ): Promise<{
    readonly approvals: ReadonlySet<ModeratorId>;
    readonly rejections: ReadonlySet<ModeratorId>;
  }> => {
    const raw = await deps.redis.hgetall(consensusKey(ruleId));
    const approvals = new Set<ModeratorId>();
    const rejections = new Set<ModeratorId>();
    for (const [voter, json] of Object.entries(raw)) {
      const parsed = JSON.parse(json) as { vote: 'approve' | 'reject' };
      if (parsed.vote === 'approve') approvals.add(voter as ModeratorId);
      else rejections.add(voter as ModeratorId);
    }
    return { approvals, rejections };
  },

  /**
   * Throws ConsensusRequired if the rule isn't approved yet. Called from
   * ActivateRule command handler before the activation event is appended.
   */
  enforce: async (input: {
    readonly rule: RuleAggregate;
    readonly mode: ConsensusMode;
    readonly authoringModerator: ModeratorId;
    readonly clauseVerdicts: readonly ActionKind[];
  }): Promise<void> => {
    const requirement = requirementFor(input.mode, input.clauseVerdicts);
    if (requirement.required <= 1) return;
    const tally = await buildConsensusCoordinator(deps).readTally(input.rule.id);
    if (!isSatisfied(requirement, tally, input.authoringModerator)) {
      throw new ConsensusRequired(requirement.required, 1 + tally.approvals.size);
    }
  },

  /**
   * Clear tally — called after the rule successfully activates so the
   * hash doesn't accumulate stale votes if the rule is later re-activated.
   */
  clear: async (ruleId: RuleId): Promise<void> => {
    await deps.redis.del(consensusKey(ruleId));
  },
});

export type ConsensusCoordinator = ReturnType<typeof buildConsensusCoordinator>;

import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { EffectivenessLeaderboard } from '@infrastructure/projections/EffectivenessLeaderboardProjection';
import { computeEffectiveness } from '@domain/values/EffectivenessScore';
import {
  brandTimestampMs,
  type RuleId,
  type SubredditId,
  type TimestampMs,
} from '@shared/types/BrandedPrimitives';
import { mintUlid } from '@shared/utilities/Ulid';
import { isEventKind } from '@domain/events/DomainEvent';
import { buildConfidence } from '@domain/values/ConfidenceScore';
import type { Clock } from '@shared/utilities/Clock';

/**
 * Effectiveness scorer. Runs every 2 h on the
 * effectiveness-recompute scheduler.
 *
 * For each active rule:
 *   matches            = count(ActionTaken)
 *   reversals          = count(ActionReversed targeting that rule's actions)
 *   conflictPenalties  = count(ConflictDetected with this rule as left or right)
 *   score              = computeEffectiveness(matches, reversals, conflictPenalties)
 *
 * Persists:
 *   - EffectivenessRecomputed event (audit trail)
 *   - EffectivenessLeaderboard zset (sorted by score, for dashboards)
 */

export const buildEffectivenessScorer = (deps: {
  readonly events: EventStore;
  readonly activeRules: ActiveRulesProjection;
  readonly leaderboard: EffectivenessLeaderboard;
  readonly clock: Clock;
}) => ({
  recompute: async (
    subreddit: SubredditId,
    windowMs: number,
  ): Promise<{
    readonly recomputed: number;
    readonly perRule: readonly {
      ruleId: RuleId;
      matches: number;
      reversals: number;
      score: number;
    }[];
  }> => {
    const now = deps.clock.now();
    const windowStart = brandTimestampMs(now - windowMs);
    const events = await deps.events.readWindow({
      subreddit,
      fromInclusive: windowStart,
      toExclusive: brandTimestampMs(now + 1),
    });

    const stats = new Map<
      RuleId,
      { matches: number; reversals: number; conflictPenalties: number }
    >();
    const actionEventByActionId = new Map<string, RuleId>();

    for (const event of events) {
      if (isEventKind(event, 'ActionTaken')) {
        const ruleId = event.payload.ruleId;
        const s = stats.get(ruleId) ?? { matches: 0, reversals: 0, conflictPenalties: 0 };
        s.matches += 1;
        stats.set(ruleId, s);
        actionEventByActionId.set(event.eventId, ruleId);
      } else if (isEventKind(event, 'ActionReversed')) {
        const original = actionEventByActionId.get(event.payload.originalActionEventId);
        if (original) {
          const s = stats.get(original) ?? { matches: 0, reversals: 0, conflictPenalties: 0 };
          s.reversals += 1;
          stats.set(original, s);
        }
      } else if (isEventKind(event, 'ConflictDetected')) {
        for (const ruleId of [event.payload.leftRule, event.payload.rightRule]) {
          const s = stats.get(ruleId) ?? { matches: 0, reversals: 0, conflictPenalties: 0 };
          s.conflictPenalties += 1;
          stats.set(ruleId, s);
        }
      }
    }

    const perRule: { ruleId: RuleId; matches: number; reversals: number; score: number }[] = [];
    for (const [ruleId, s] of stats.entries()) {
      const snapshot = computeEffectiveness({ ...s, computedAt: now });
      await deps.leaderboard.update(subreddit, ruleId, snapshot.score);
      await deps.events.append({
        eventId: mintUlid(() => now),
        subreddit,
        occurredAt: now,
        actor: 'system',
        payload: {
          kind: 'EffectivenessRecomputed',
          ruleId,
          matches: s.matches,
          reversals: s.reversals,
          conflictPenalties: s.conflictPenalties,
          score: buildConfidence(snapshot.score),
        },
      });
      perRule.push({ ruleId, matches: s.matches, reversals: s.reversals, score: snapshot.score });
    }

    return { recomputed: perRule.length, perRule };
  },
});

export type EffectivenessScorer = ReturnType<typeof buildEffectivenessScorer>;

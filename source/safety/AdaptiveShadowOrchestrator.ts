import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';
import type { ConfidenceScore } from '@domain/values/ConfidenceScore';
import { decidePromotion } from '@domain/policies/AdaptiveShadowPolicy';
import type { TimestampMs } from '@shared/types/BrandedPrimitives';
import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import { mintUlid } from '@shared/utilities/Ulid';
import type { Clock } from '@shared/utilities/Clock';
import { isObserving } from '@domain/values/ShadowStatus';
import type { SubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Adaptive shadow orchestrator. Runs on the shadow-promotion-sweep
 * scheduler (every 10 min). For every rule in `shadowed` phase:
 *   - reads the aggregate from the active-rules projection
 *   - asks AdaptiveShadowPolicy whether it's ready to promote
 *   - if yes, appends a RulePromoted event (which then projects)
 *
 * Rather than "wait N hours then go live no matter what", we wait until
 * we've observed enough evidence to be confident the rule isn't dangerous
 * — and we cap how long we'll wait so a rule never lingers in shadow
 * indefinitely.
 */

export interface AdaptiveShadowConfig {
  readonly threshold: ConfidenceScore;
  readonly minObservations: number;
  readonly hardCapMs: number;
}

export interface AdaptiveSweepResult {
  readonly considered: number;
  readonly promoted: number;
  readonly notes: readonly string[];
}

export const buildAdaptiveShadowOrchestrator = (deps: {
  readonly activeRules: ActiveRulesProjection;
  readonly events: EventStore;
  readonly clock: Clock;
}) => ({
  sweep: async (
    subreddit: SubredditId,
    config: AdaptiveShadowConfig,
  ): Promise<AdaptiveSweepResult> => {
    const view = await deps.activeRules.readActive(subreddit);
    const now = deps.clock.now();
    let promoted = 0;
    const notes: string[] = [];

    for (const rule of view.rules) {
      if (!isObserving(rule.shadowStatus)) continue;
      const enteredAt = rule.shadowStatus.enteredShadowAt;
      if (enteredAt === null) continue;

      const decision = decidePromotion({
        observations: rule.shadowStatus.observations,
        shadowReversals: rule.shadowStatus.shadowReversals,
        enteredShadowAt: enteredAt,
        threshold: config.threshold,
        minObservations: config.minObservations,
        hardCapMs: config.hardCapMs,
        now,
      });

      if (decision.shouldPromote) {
        await deps.events.append({
          eventId: mintUlid(() => now),
          subreddit,
          occurredAt: now,
          actor: 'system',
          payload: {
            kind: 'RulePromoted',
            ruleId: rule.id,
            version: rule.currentVersion,
            reason: decision.reason === 'time-cap' ? 'time-cap' : 'adaptive-confidence',
            finalConfidence: decision.confidence,
          },
        });
        promoted += 1;
        notes.push(
          `${rule.id}: promoted (reason=${decision.reason}, conf=${decision.confidence.toFixed(2)})`,
        );
      } else if (decision.reason === 'reversal-rate-too-high') {
        notes.push(`${rule.id}: held (reversal rate too high)`);
      }
    }

    return { considered: view.rules.length, promoted, notes };
  },

  /** Direct API for unit tests. */
  evaluatePromotion: (rule: RuleAggregate, config: AdaptiveShadowConfig, now: TimestampMs) => {
    if (rule.shadowStatus.enteredShadowAt === null) return null;
    return decidePromotion({
      observations: rule.shadowStatus.observations,
      shadowReversals: rule.shadowStatus.shadowReversals,
      enteredShadowAt: rule.shadowStatus.enteredShadowAt,
      threshold: config.threshold,
      minObservations: config.minObservations,
      hardCapMs: config.hardCapMs,
      now,
    });
  },
});

export type AdaptiveShadowOrchestrator = ReturnType<typeof buildAdaptiveShadowOrchestrator>;

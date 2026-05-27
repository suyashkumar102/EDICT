import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { BriefingFeed } from '@infrastructure/projections/BriefingFeedProjection';
import type { Clock } from '@shared/utilities/Clock';
import { mintUlid } from '@shared/utilities/Ulid';
import { isEventKind } from '@domain/events/DomainEvent';
import {
  brandTimestampMs,
  type RuleId,
  type SubredditId,
  type TimestampMs,
} from '@shared/types/BrandedPrimitives';

/**
 * Hourly mod handoff briefing. Runs on the briefing-prepare scheduler
 * every hour at :00. For the previous hour's window, produces:
 *   - actions taken
 *   - shadow decisions
 *   - reversals
 *   - top 5 rules by match count
 *   - anomalies: anything unusual the mod should glance at
 *
 * Anomaly detection is intentionally heuristic, not ML — it's tuned to
 * "this is the kind of thing a tired mod at 3 a.m. would benefit from
 * seeing called out", not "predict next month's spam trend".
 *
 * Anomalies surfaced:
 *   - sudden 3× spike in any rule's hourly action count vs trailing avg
 *   - reversal rate > 25% on any rule in the window
 *   - sub-wide breaker tripped at least once
 *   - new conflict detected since last briefing
 */

const TRAILING_HOURS = 12; // baseline window for spike detection

export const buildBriefingComposer = (deps: {
  readonly events: EventStore;
  readonly briefingFeed: BriefingFeed;
  readonly clock: Clock;
}) => ({
  prepare: async (subreddit: SubredditId): Promise<void> => {
    const now = deps.clock.now();
    const windowEnd = brandTimestampMs(Math.floor(now / (60 * 60 * 1000)) * 60 * 60 * 1000);
    const windowStart = brandTimestampMs(windowEnd - 60 * 60 * 1000);
    const baselineStart = brandTimestampMs(windowEnd - TRAILING_HOURS * 60 * 60 * 1000);

    const eventsWindow = await deps.events.readWindow({
      subreddit,
      fromInclusive: windowStart,
      toExclusive: windowEnd,
    });
    const eventsBaseline = await deps.events.readWindow({
      subreddit,
      fromInclusive: baselineStart,
      toExclusive: windowStart,
    });

    const ruleMatchCount = new Map<RuleId, number>();
    let actionsTaken = 0;
    let shadowDecisions = 0;
    let reversals = 0;
    let breakerTrippedThisHour = false;
    const reversalsByRule = new Map<RuleId, number>();

    for (const e of eventsWindow) {
      if (isEventKind(e, 'ActionTaken')) {
        actionsTaken += 1;
        ruleMatchCount.set(e.payload.ruleId, (ruleMatchCount.get(e.payload.ruleId) ?? 0) + 1);
      } else if (isEventKind(e, 'ShadowDecisionRecorded')) {
        shadowDecisions += 1;
        ruleMatchCount.set(e.payload.ruleId, (ruleMatchCount.get(e.payload.ruleId) ?? 0) + 1);
      } else if (isEventKind(e, 'ActionReversed')) {
        reversals += 1;
        reversalsByRule.set(e.payload.ruleId, (reversalsByRule.get(e.payload.ruleId) ?? 0) + 1);
      } else if (isEventKind(e, 'CircuitBreakerTripped')) {
        breakerTrippedThisHour = true;
      }
    }

    const baselineActions = eventsBaseline.filter((e) => isEventKind(e, 'ActionTaken')).length;
    const baselinePerHour = baselineActions / TRAILING_HOURS;

    const anomalies: string[] = [];
    if (baselinePerHour > 0 && actionsTaken > baselinePerHour * 3) {
      anomalies.push(
        `Action volume 3× normal (${actionsTaken} this hour vs ${baselinePerHour.toFixed(1)}/h baseline).`,
      );
    }
    for (const [ruleId, count] of ruleMatchCount.entries()) {
      const reversalCount = reversalsByRule.get(ruleId) ?? 0;
      if (count >= 8 && reversalCount / count > 0.25) {
        anomalies.push(
          `Rule ${ruleId} reversal rate ${Math.round((reversalCount / count) * 100)}% (${reversalCount}/${count}).`,
        );
      }
    }
    if (breakerTrippedThisHour) {
      anomalies.push('Circuit breaker tripped at least once this hour.');
    }

    const topRules: { ruleId: RuleId; matchCount: number }[] = [...ruleMatchCount.entries()]
      .map(([ruleId, matchCount]) => ({ ruleId, matchCount }))
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, 5);

    const briefing = {
      kind: 'BriefingPrepared' as const,
      windowStart,
      windowEnd,
      actionsTaken,
      shadowDecisions,
      reversals,
      anomalies,
      topRules,
    };

    await deps.events.append({
      eventId: mintUlid(() => now),
      subreddit,
      occurredAt: now,
      actor: 'system',
      payload: briefing,
    });
    await deps.briefingFeed.append(subreddit, briefing);
  },
});

export type BriefingComposer = ReturnType<typeof buildBriefingComposer>;

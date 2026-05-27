import type { DomainEvent } from '@domain/events/DomainEvent';
import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { AuditTimelineProjection } from '@infrastructure/projections/AuditTimelineProjection';
import type { BriefingFeed } from '@infrastructure/projections/BriefingFeedProjection';
import type { EffectivenessLeaderboard } from '@infrastructure/projections/EffectivenessLeaderboardProjection';
import { isEventKind } from '@domain/events/DomainEvent';

/**
 * The EventDispatcher fans an event out to every projection that cares.
 * It's invoked by the CommandBus after every event-store append, and
 * also by the event-store-compaction scheduler when rebuilding
 * projections from scratch.
 *
 * The order is deterministic: ActiveRules first (it's the cache layer
 * other queries depend on), then AuditTimeline (high-volume, fast),
 * then BriefingFeed (only emits on BriefingPrepared), then
 * EffectivenessLeaderboard (only emits on EffectivenessRecomputed).
 */
export const buildEventDispatcher = (deps: {
  readonly activeRules: ActiveRulesProjection;
  readonly auditTimeline: AuditTimelineProjection;
  readonly briefingFeed: BriefingFeed;
  readonly leaderboard: EffectivenessLeaderboard;
}) => ({
  dispatch: async (event: DomainEvent): Promise<void> => {
    await deps.activeRules.applyEvent(event);
    await deps.auditTimeline.applyEvent(event);
    if (isEventKind(event, 'BriefingPrepared')) {
      await deps.briefingFeed.append(event.subreddit, event.payload);
    }
    if (isEventKind(event, 'EffectivenessRecomputed')) {
      await deps.leaderboard.update(event.subreddit, event.payload.ruleId, event.payload.score);
    }
  },
});

export type EventDispatcher = ReturnType<typeof buildEventDispatcher>;

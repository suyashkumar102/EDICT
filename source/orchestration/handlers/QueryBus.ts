import type { Query } from '@orchestration/queries/Queries';
import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { AuditTimelineProjection } from '@infrastructure/projections/AuditTimelineProjection';
import type { BriefingFeed } from '@infrastructure/projections/BriefingFeedProjection';
import type { EffectivenessLeaderboard } from '@infrastructure/projections/EffectivenessLeaderboardProjection';
import type { ConflictMap } from '@infrastructure/projections/ConflictMapProjection';
import type { TemplateGallery } from '@infrastructure/devvit/TemplateGallery';
import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';

/**
 * QueryBus reads from projections only. Never the event log directly,
 * never a fresh evaluation. The projections are kept current by the
 * CommandBus's appendAndProject path, so what the QueryBus returns
 * reflects every event applied so far.
 *
 * If a query needs data from multiple projections (e.g. the Command
 * Center digest), we read from each in turn and assemble the response
 * — no joins, no transactions, by design.
 */

export interface QueryBusDeps {
  readonly activeRules: ActiveRulesProjection;
  readonly auditTimeline: AuditTimelineProjection;
  readonly briefingFeed: BriefingFeed;
  readonly leaderboard: EffectivenessLeaderboard;
  readonly conflictMap: ConflictMap;
  readonly templateGallery: TemplateGallery;
}

export interface CommandCenterDigest {
  readonly activeRuleCount: number;
  readonly shadowRuleCount: number;
  readonly recentAuditEntries: number;
  readonly latestBriefingSummary: string;
  readonly conflictCount: number;
  readonly topRule: { readonly ruleId: string; readonly title: string } | null;
}

export const buildQueryBus = (deps: QueryBusDeps) => ({
  ask: async (query: Query): Promise<unknown> => {
    switch (query.kind) {
      case 'GetCommandCenterDigest': {
        const active = await deps.activeRules.readActive(query.subreddit);
        const shadowCount = active.rules.filter((r) => r.shadowStatus.phase === 'shadowed').length;
        const audit = await deps.auditTimeline.readRecent(query.subreddit, 5);
        const briefings = await deps.briefingFeed.readLatest(query.subreddit, 1);
        const conflicts = await deps.conflictMap.listAll(query.subreddit);
        const top = active.rules[0];
        const digest: CommandCenterDigest = {
          activeRuleCount: active.rules.length,
          shadowRuleCount: shadowCount,
          recentAuditEntries: audit.length,
          latestBriefingSummary: briefings[0]
            ? `${briefings[0].actionsTaken} actions, ${briefings[0].reversals} reversed`
            : 'no briefing yet',
          conflictCount: conflicts.length,
          topRule: top ? { ruleId: top.id, title: top.title } : null,
        };
        return digest;
      }
      case 'GetActiveRules': {
        const view = await deps.activeRules.readActive(query.subreddit);
        return query.includePaused
          ? view.rules
          : view.rules.filter((r) => r.shadowStatus.phase !== 'paused');
      }
      case 'GetRuleDetail': {
        const aggregate: RuleAggregate | null = await deps.activeRules.readById(
          query.subreddit,
          query.ruleId,
        );
        return aggregate;
      }
      case 'GetAuditTimeline':
        return query.ruleId
          ? deps.auditTimeline.readForRule(query.subreddit, query.ruleId, query.limit)
          : deps.auditTimeline.readRecent(query.subreddit, query.limit, query.category);
      case 'GetBriefingFeed':
        return query.since
          ? deps.briefingFeed.readSince(query.subreddit, query.since)
          : deps.briefingFeed.readLatest(query.subreddit, 10);
      case 'GetEffectivenessLeaderboard':
        return deps.leaderboard.topN(query.subreddit, query.top);
      case 'GetConflictMap':
        return query.ruleId
          ? deps.conflictMap.listForRule(query.subreddit, query.ruleId)
          : deps.conflictMap.listAll(query.subreddit);
      case 'GetWhatIfReport':
        // What-if reports are produced on demand by WhatIfStudio; we
        // return null here and the route handler invokes the studio.
        return null;
      case 'GetTemplateGallery':
        return deps.templateGallery.list(query.category);
    }
  },
});

export type QueryBus = ReturnType<typeof buildQueryBus>;

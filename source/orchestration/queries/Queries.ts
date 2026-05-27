import type { RuleId, SubredditId, TimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Queries are read-side requests. They return data, not state changes.
 * Every query reads from a read-model projection — never the event log
 * directly — so the same data the Command Center renders can be
 * compared cell-for-cell with the projections.
 */

export type Query =
  | GetCommandCenterDigest
  | GetActiveRules
  | GetRuleDetail
  | GetAuditTimeline
  | GetBriefingFeed
  | GetEffectivenessLeaderboard
  | GetConflictMap
  | GetWhatIfReport
  | GetTemplateGallery;

interface QueryBase {
  readonly subreddit: SubredditId;
}

export interface GetCommandCenterDigest extends QueryBase {
  readonly kind: 'GetCommandCenterDigest';
}

export interface GetActiveRules extends QueryBase {
  readonly kind: 'GetActiveRules';
  readonly includePaused?: boolean;
}

export interface GetRuleDetail extends QueryBase {
  readonly kind: 'GetRuleDetail';
  readonly ruleId: RuleId;
}

export interface GetAuditTimeline extends QueryBase {
  readonly kind: 'GetAuditTimeline';
  readonly limit: number;
  readonly category?: 'lifecycle' | 'action' | 'safety';
  readonly ruleId?: RuleId;
}

export interface GetBriefingFeed extends QueryBase {
  readonly kind: 'GetBriefingFeed';
  readonly since?: TimestampMs;
}

export interface GetEffectivenessLeaderboard extends QueryBase {
  readonly kind: 'GetEffectivenessLeaderboard';
  readonly top: number;
}

export interface GetConflictMap extends QueryBase {
  readonly kind: 'GetConflictMap';
  readonly ruleId?: RuleId;
}

export interface GetWhatIfReport extends QueryBase {
  readonly kind: 'GetWhatIfReport';
  readonly ruleId: RuleId;
}

export interface GetTemplateGallery extends QueryBase {
  readonly kind: 'GetTemplateGallery';
  readonly category?: string;
}

export type AnyQueryKind = Query['kind'];

import type {
  ModeratorId,
  RuleId,
  RuleVersion,
  SubredditId,
  TimestampMs,
} from '@shared/types/BrandedPrimitives';
import type { RuleClause } from '@domain/values/RuleClause';
import type { ShadowStatus } from '@domain/values/ShadowStatus';
import { initialShadowStatus } from '@domain/values/ShadowStatus';
import type { ConfidenceScore } from '@domain/values/ConfidenceScore';
import type { EffectivenessSnapshot } from '@domain/values/EffectivenessScore';

/**
 * RuleAggregate is the consistency boundary for a single rule. It owns:
 *   - the *current* compiled version (clauses, verdict)
 *   - the *history* of prior versions (git-style)
 *   - the shadow / live status
 *   - the latest effectiveness snapshot
 *   - the active circuit-breaker state (rule-scoped)
 *
 * Aggregates are immutable values in TypeScript; mutation goes through the
 * apply/decide pattern below (decide → events → apply → next state).
 * Hydrate from the event store with `replay(events, initialAggregate)`.
 */

export interface RuleAuthorNote {
  readonly authoredBy: ModeratorId;
  readonly authoredAt: TimestampMs;
  readonly englishSource: string;
  readonly compilerConfidence: ConfidenceScore;
  readonly clarificationsAnswered: number;
}

export interface RuleVersionRecord {
  readonly version: RuleVersion;
  readonly clauses: readonly RuleClause[];
  readonly author: RuleAuthorNote;
  readonly parent: RuleVersion | null; // null for v1
  readonly diffSummary: string; // 'added clause "low karma"', etc.
}

export interface RuleBreakerState {
  readonly hourlyActionCount: number;
  readonly currentHourBucket: number;
  readonly tripUntil: TimestampMs | null;
  readonly tripCount: number;
}

export interface RuleAggregate {
  readonly id: RuleId;
  readonly subreddit: SubredditId;
  readonly title: string;
  readonly description: string;
  readonly currentVersion: RuleVersion;
  readonly versions: readonly RuleVersionRecord[]; // newest last
  readonly shadowStatus: ShadowStatus;
  readonly effectiveness: EffectivenessSnapshot | null;
  readonly breaker: RuleBreakerState;
  readonly pendingConsensusVoters: readonly ModeratorId[];
  readonly archivedAt: TimestampMs | null;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
}

export const buildInitialRule = (input: {
  readonly id: RuleId;
  readonly subreddit: SubredditId;
  readonly title: string;
  readonly description: string;
  readonly initialVersion: RuleVersionRecord;
  readonly createdAt: TimestampMs;
}): RuleAggregate => ({
  id: input.id,
  subreddit: input.subreddit,
  title: input.title,
  description: input.description,
  currentVersion: input.initialVersion.version,
  versions: [input.initialVersion],
  shadowStatus: initialShadowStatus(),
  effectiveness: null,
  breaker: {
    hourlyActionCount: 0,
    currentHourBucket: Math.floor(input.createdAt / (60 * 60 * 1000)),
    tripUntil: null,
    tripCount: 0,
  },
  pendingConsensusVoters: [],
  archivedAt: null,
  createdAt: input.createdAt,
  updatedAt: input.createdAt,
});

export const latestClauses = (rule: RuleAggregate): readonly RuleClause[] => {
  const v = rule.versions.find((rv) => rv.version === rule.currentVersion);
  if (!v)
    throw new Error(
      `RuleAggregate ${rule.id} has no record for current version ${rule.currentVersion}`,
    );
  return v.clauses;
};

export const isActive = (rule: RuleAggregate): boolean =>
  rule.shadowStatus.phase === 'shadowed' || rule.shadowStatus.phase === 'live';

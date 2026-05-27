import type {
  ModeratorId,
  RuleId,
  RuleVersion,
  SubredditId,
  ThingId,
  TimestampMs,
  ULID,
} from '@shared/types/BrandedPrimitives';
import type { RuleClause } from '@domain/values/RuleClause';
import type { ConfidenceScore } from '@domain/values/ConfidenceScore';
import type { ActionVerdict } from '@domain/values/ActionVerdict';

/**
 * Every state change in EDICT is expressed as an immutable DomainEvent.
 * The event log is the source of truth; aggregates and read models are
 * projections of the log.
 *
 * Versioning rule: never edit an event shape. Add a new variant
 * (e.g. RuleActivatedV2) and a translator instead. The shape that goes into
 * the event store is the shape that comes out, forever.
 *
 * Discriminator: `kind` (string literal). Don't switch on anything else.
 */

export interface EventEnvelope<TPayload> {
  readonly eventId: ULID;
  readonly subreddit: SubredditId;
  readonly occurredAt: TimestampMs;
  readonly actor: ModeratorId | 'system';
  readonly payload: TPayload;
}

export type DomainEvent =
  | EventEnvelope<RuleDrafted>
  | EventEnvelope<ClarificationRequested>
  | EventEnvelope<ClarificationAnswered>
  | EventEnvelope<RuleCompiled>
  | EventEnvelope<RuleActivated>
  | EventEnvelope<ShadowDecisionRecorded>
  | EventEnvelope<RulePromoted>
  | EventEnvelope<RulePaused>
  | EventEnvelope<RuleResumed>
  | EventEnvelope<RuleArchived>
  | EventEnvelope<RuleAmended>
  | EventEnvelope<RuleReverted>
  | EventEnvelope<ActionTaken>
  | EventEnvelope<ActionReversed>
  | EventEnvelope<ConsensusVoteCast>
  | EventEnvelope<CircuitBreakerTripped>
  | EventEnvelope<CircuitBreakerReset>
  | EventEnvelope<BriefingPrepared>
  | EventEnvelope<EffectivenessRecomputed>
  | EventEnvelope<ConflictDetected>
  | EventEnvelope<SuggestionGenerated>
  | EventEnvelope<TemplateImported>;

export interface RuleDrafted {
  readonly kind: 'RuleDrafted';
  readonly ruleId: RuleId;
  readonly englishSource: string;
  readonly title: string;
  readonly description: string;
}

export interface ClarificationRequested {
  readonly kind: 'ClarificationRequested';
  readonly ruleId: RuleId;
  readonly question: string;
  readonly options: readonly string[];
}

export interface ClarificationAnswered {
  readonly kind: 'ClarificationAnswered';
  readonly ruleId: RuleId;
  readonly answer: string;
}

export interface RuleCompiled {
  readonly kind: 'RuleCompiled';
  readonly ruleId: RuleId;
  readonly version: RuleVersion;
  readonly clauses: readonly RuleClause[];
  readonly confidence: ConfidenceScore;
  readonly diffSummary: string;
}

export interface RuleActivated {
  readonly kind: 'RuleActivated';
  readonly ruleId: RuleId;
  readonly version: RuleVersion;
  readonly enteringPhase: 'shadowed' | 'live';
  readonly initialConsensusVoters?: readonly ModeratorId[];
}

export interface ShadowDecisionRecorded {
  readonly kind: 'ShadowDecisionRecorded';
  readonly ruleId: RuleId;
  readonly version: RuleVersion;
  readonly thingId: ThingId;
  readonly verdict: ActionVerdict;
  readonly matchedClauseName: string;
  readonly factBagSnapshot: Readonly<Record<string, string | number | boolean>>;
  readonly explanationTrace: readonly string[];
}

export interface RulePromoted {
  readonly kind: 'RulePromoted';
  readonly ruleId: RuleId;
  readonly version: RuleVersion;
  readonly reason: 'adaptive-confidence' | 'time-cap' | 'manual';
  readonly finalConfidence: ConfidenceScore;
}

export interface RulePaused {
  readonly kind: 'RulePaused';
  readonly ruleId: RuleId;
  readonly reason: 'manual' | 'breaker' | 'conflict';
  readonly note?: string;
}

export interface RuleResumed {
  readonly kind: 'RuleResumed';
  readonly ruleId: RuleId;
  readonly note?: string;
}

export interface RuleArchived {
  readonly kind: 'RuleArchived';
  readonly ruleId: RuleId;
  readonly reason: string;
}

export interface RuleAmended {
  readonly kind: 'RuleAmended';
  readonly ruleId: RuleId;
  readonly fromVersion: RuleVersion;
  readonly toVersion: RuleVersion;
  readonly clauses: readonly RuleClause[];
  readonly diffSummary: string;
  readonly confidence: ConfidenceScore;
}

export interface RuleReverted {
  readonly kind: 'RuleReverted';
  readonly ruleId: RuleId;
  readonly fromVersion: RuleVersion;
  readonly toVersion: RuleVersion;
}

export interface ActionTaken {
  readonly kind: 'ActionTaken';
  readonly ruleId: RuleId;
  readonly version: RuleVersion;
  readonly thingId: ThingId;
  readonly verdict: ActionVerdict;
  readonly matchedClauseName: string;
  readonly factBagSnapshot: Readonly<Record<string, string | number | boolean>>;
  readonly rollbackTokenId: ULID;
  readonly rollbackExpiresAt: TimestampMs;
}

export interface ActionReversed {
  readonly kind: 'ActionReversed';
  readonly ruleId: RuleId;
  readonly originalActionEventId: ULID;
  readonly thingId: ThingId;
  readonly reasonNote?: string;
  /** Snapshot of fact-bag at reversal, fed to UndoLearningStrategy. */
  readonly learningSnapshot: Readonly<Record<string, string | number | boolean>>;
}

export interface ConsensusVoteCast {
  readonly kind: 'ConsensusVoteCast';
  readonly ruleId: RuleId;
  readonly voter: ModeratorId;
  readonly vote: 'approve' | 'reject';
  readonly note?: string;
}

export interface CircuitBreakerTripped {
  readonly kind: 'CircuitBreakerTripped';
  readonly scope: 'rule' | 'subreddit';
  readonly ruleId: RuleId | null;
  readonly actionsInWindow: number;
  readonly ceiling: number;
  readonly cooldownUntil: TimestampMs;
}

export interface CircuitBreakerReset {
  readonly kind: 'CircuitBreakerReset';
  readonly scope: 'rule' | 'subreddit';
  readonly ruleId: RuleId | null;
}

export interface BriefingPrepared {
  readonly kind: 'BriefingPrepared';
  readonly windowStart: TimestampMs;
  readonly windowEnd: TimestampMs;
  readonly actionsTaken: number;
  readonly shadowDecisions: number;
  readonly reversals: number;
  readonly anomalies: readonly string[];
  readonly topRules: readonly { ruleId: RuleId; matchCount: number }[];
}

export interface EffectivenessRecomputed {
  readonly kind: 'EffectivenessRecomputed';
  readonly ruleId: RuleId;
  readonly matches: number;
  readonly reversals: number;
  readonly conflictPenalties: number;
  readonly score: ConfidenceScore;
}

export interface ConflictDetected {
  readonly kind: 'ConflictDetected';
  readonly leftRule: RuleId;
  readonly rightRule: RuleId;
  readonly conflictKind: 'overlap' | 'contradiction' | 'shadowing';
  readonly description: string;
}

export interface SuggestionGenerated {
  readonly kind: 'SuggestionGenerated';
  readonly suggestionId: ULID;
  readonly basedOnReversals: readonly ULID[];
  readonly proposedEnglish: string;
  readonly estimatedCatchRate: ConfidenceScore;
}

export interface TemplateImported {
  readonly kind: 'TemplateImported';
  readonly templateSlug: string;
  readonly ruleId: RuleId;
  readonly forkedFromVersion: string;
}

/** Helper for narrowing in handlers. */
export const isEventKind = <K extends DomainEvent['payload']['kind']>(
  event: DomainEvent,
  kind: K,
): event is Extract<DomainEvent, { payload: { kind: K } }> => event.payload.kind === kind;

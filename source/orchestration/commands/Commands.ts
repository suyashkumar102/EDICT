import type { ActionKind } from '@domain/values/ActionVerdict';
import type {
  ModeratorId,
  RuleId,
  RuleVersion,
  SubredditId,
  ThingId,
  ULID,
} from '@shared/types/BrandedPrimitives';

/**
 * Commands are imperative intents from the interface layer. They are
 * dispatched to CommandHandlers; handlers may emit zero, one, or many
 * DomainEvents.
 *
 * Why DTOs (not plain functions): commands carry metadata (actor,
 * correlationId) that's threaded into every emitted event. Centralising
 * keeps the audit trail consistent without each handler reinventing it.
 */

interface CommandBase {
  readonly subreddit: SubredditId;
  readonly actor: ModeratorId;
  readonly correlationId: ULID;
}

export type Command =
  | DraftRuleCommand
  | AnswerClarificationCommand
  | CompileRuleCommand
  | RunWhatIfCommand
  | ActivateRuleCommand
  | PauseRuleCommand
  | ResumeRuleCommand
  | ArchiveRuleCommand
  | AmendRuleCommand
  | RevertRuleCommand
  | CastConsensusVoteCommand
  | ReverseActionCommand
  | ImportTemplateCommand;

export interface DraftRuleCommand extends CommandBase {
  readonly kind: 'DraftRule';
  readonly englishSource: string;
  readonly title: string;
  readonly description: string;
  readonly optInActions: readonly ActionKind[];
}

export interface AnswerClarificationCommand extends CommandBase {
  readonly kind: 'AnswerClarification';
  readonly ruleId: RuleId;
  readonly answer: string;
}

export interface CompileRuleCommand extends CommandBase {
  readonly kind: 'CompileRule';
  readonly ruleId: RuleId;
  readonly model: string;
  readonly verbosity: 'strict' | 'balanced' | 'permissive';
  readonly optInActions: readonly ActionKind[];
}

export interface RunWhatIfCommand extends CommandBase {
  readonly kind: 'RunWhatIf';
  readonly ruleId: RuleId;
  readonly windowDays: number;
}

export interface ActivateRuleCommand extends CommandBase {
  readonly kind: 'ActivateRule';
  readonly ruleId: RuleId;
  readonly consensusMode: 'off' | 'risky' | 'strict';
  /**
   * Where the rule enters the lifecycle. Default 'shadowed' (records what
   * it would do; doesn't act). Pass 'live' from the demo menu to skip
   * shadow and have the rule act on real posts immediately.
   */
  readonly enteringPhase?: 'shadowed' | 'live';
}

export interface PauseRuleCommand extends CommandBase {
  readonly kind: 'PauseRule';
  readonly ruleId: RuleId;
  readonly note?: string;
}

export interface ResumeRuleCommand extends CommandBase {
  readonly kind: 'ResumeRule';
  readonly ruleId: RuleId;
  readonly note?: string;
}

export interface ArchiveRuleCommand extends CommandBase {
  readonly kind: 'ArchiveRule';
  readonly ruleId: RuleId;
  readonly reason: string;
}

export interface AmendRuleCommand extends CommandBase {
  readonly kind: 'AmendRule';
  readonly ruleId: RuleId;
  readonly newEnglishSource: string;
  readonly optInActions: readonly ActionKind[];
}

export interface RevertRuleCommand extends CommandBase {
  readonly kind: 'RevertRule';
  readonly ruleId: RuleId;
  readonly toVersion: RuleVersion;
}

export interface CastConsensusVoteCommand extends CommandBase {
  readonly kind: 'CastConsensusVote';
  readonly ruleId: RuleId;
  readonly vote: 'approve' | 'reject';
  readonly note?: string;
}

export interface ReverseActionCommand extends CommandBase {
  readonly kind: 'ReverseAction';
  readonly rollbackTokenId: ULID;
  readonly note?: string;
}

export interface ImportTemplateCommand extends CommandBase {
  readonly kind: 'ImportTemplate';
  readonly templateSlug: string;
}

export type AnyCommandKind = Command['kind'];

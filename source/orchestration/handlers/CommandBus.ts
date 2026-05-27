import type { Command } from '@orchestration/commands/Commands';
import type { DomainEvent } from '@domain/events/DomainEvent';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { AuditTimelineProjection } from '@infrastructure/projections/AuditTimelineProjection';
import type { ConsensusCoordinator } from '@safety/ConsensusCoordinator';
import type { RollbackTokenService } from '@safety/RollbackTokenService';
import type { CompilerService } from '@compilation/llm/CompilerService';
import type { Clock } from '@shared/utilities/Clock';
import type { RuleClause } from '@domain/values/RuleClause';
import { resolveCompilation } from '@compilation/llm/AmbiguityResolver';
import { mintUlid } from '@shared/utilities/Ulid';
import { brandRuleId, brandRuleVersion } from '@shared/types/BrandedPrimitives';
import { RuleNotFound, RuleStateConflict } from '@shared/errors/DomainError';

/**
 * The CommandBus accepts a Command and produces a list of resulting
 * DomainEvents. Side effects (event-store append, projection apply,
 * Reddit API calls) are coordinated here.
 *
 * Why a bus and not direct method calls: the bus is the one place we
 * thread cross-cutting concerns (correlation IDs, audit, error handling,
 * post-commit projection updates) through every command. Inlining this
 * into 12 different routes would mean 12 places to forget to update.
 *
 * Handlers are wired by command kind. Adding a new command means:
 *   1. add a Command variant in commands/Commands.ts
 *   2. add a handler function below
 *   3. add the dispatch case in `dispatch()`
 */

export interface CommandBusDeps {
  readonly events: EventStore;
  readonly activeRules: ActiveRulesProjection;
  readonly auditTimeline: AuditTimelineProjection;
  readonly compiler: CompilerService;
  readonly consensus: ConsensusCoordinator;
  readonly rollback: RollbackTokenService;
  readonly clock: Clock;
}

const appendAndProject = async (deps: CommandBusDeps, event: DomainEvent): Promise<void> => {
  await deps.events.append(event);
  await deps.activeRules.applyEvent(event);
  await deps.auditTimeline.applyEvent(event);
};

const handleDraftRule = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'DraftRule' }>,
): Promise<readonly DomainEvent[]> => {
  const now = deps.clock.now();
  const ruleId = brandRuleId(mintUlid(() => now));
  const event: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: {
      kind: 'RuleDrafted',
      ruleId,
      englishSource: cmd.englishSource,
      title: cmd.title,
      description: cmd.description,
    },
  };
  await appendAndProject(deps, event);
  return [event];
};

const handleCompileRule = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'CompileRule' }>,
): Promise<readonly DomainEvent[]> => {
  const aggregate = await deps.activeRules.readById(cmd.subreddit, cmd.ruleId);
  if (!aggregate) throw new RuleNotFound(cmd.ruleId);
  const englishSource =
    aggregate.versions[aggregate.versions.length - 1]?.author.englishSource ?? '';

  const resolution = await resolveCompilation(deps.compiler, {
    englishSource,
    title: aggregate.title,
    description: aggregate.description,
    optInActions: new Set(cmd.optInActions),
    priorClarifications: [],
    model: cmd.model,
    verbosity: cmd.verbosity,
  });

  const now = deps.clock.now();
  if (resolution.outcome === 'clarify') {
    const event: DomainEvent = {
      eventId: mintUlid(() => now),
      subreddit: cmd.subreddit,
      occurredAt: now,
      actor: 'system',
      payload: {
        kind: 'ClarificationRequested',
        ruleId: cmd.ruleId,
        question: resolution.question,
        options: resolution.options,
      },
    };
    await appendAndProject(deps, event);
    return [event];
  }
  if (resolution.outcome === 'timed-out') {
    const event: DomainEvent = {
      eventId: mintUlid(() => now),
      subreddit: cmd.subreddit,
      occurredAt: now,
      actor: 'system',
      payload: {
        kind: 'ClarificationRequested',
        ruleId: cmd.ruleId,
        question: `[compiler bailed after 3 rounds] ${resolution.lastQuestion}`,
        options: ['Rewrite the rule from scratch'],
      },
    };
    await appendAndProject(deps, event);
    return [event];
  }
  // compiled
  const nextVersion = brandRuleVersion(aggregate.currentVersion + 1);
  const compiledEvent: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: {
      kind: 'RuleCompiled',
      ruleId: cmd.ruleId,
      version: nextVersion,
      clauses: resolution.result.rule.clauses as unknown as readonly RuleClause[],
      confidence: resolution.result.confidence,
      diffSummary: resolution.result.diffSummary,
    },
  };
  await appendAndProject(deps, compiledEvent);
  return [compiledEvent];
};

const handleActivateRule = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'ActivateRule' }>,
): Promise<readonly DomainEvent[]> => {
  const aggregate = await deps.activeRules.readById(cmd.subreddit, cmd.ruleId);
  if (!aggregate) throw new RuleNotFound(cmd.ruleId);
  if (aggregate.shadowStatus.phase !== 'drafted' && aggregate.shadowStatus.phase !== 'paused') {
    throw new RuleStateConflict(
      `Rule ${cmd.ruleId} is in phase ${aggregate.shadowStatus.phase}; cannot activate.`,
    );
  }
  const verdicts = aggregate.versions[aggregate.versions.length - 1]!.clauses.map(
    (c) => c.verdict.kind,
  );
  if (aggregate.versions[aggregate.versions.length - 1]!.clauses.length === 0) {
    throw new RuleStateConflict(`Rule ${cmd.ruleId} has no compiled clauses; cannot activate.`);
  }
  await deps.consensus.enforce({
    rule: aggregate,
    mode: cmd.consensusMode,
    authoringModerator: cmd.actor,
    clauseVerdicts: verdicts,
  });

  const now = deps.clock.now();
  const event: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: {
      kind: 'RuleActivated',
      ruleId: cmd.ruleId,
      version: aggregate.currentVersion,
      enteringPhase: cmd.enteringPhase ?? 'shadowed',
    },
  };
  await appendAndProject(deps, event);
  await deps.consensus.clear(cmd.ruleId);
  return [event];
};

const handlePauseRule = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'PauseRule' }>,
): Promise<readonly DomainEvent[]> => {
  const now = deps.clock.now();
  const event: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: {
      kind: 'RulePaused',
      ruleId: cmd.ruleId,
      reason: 'manual',
      ...(cmd.note ? { note: cmd.note } : {}),
    },
  };
  await appendAndProject(deps, event);
  return [event];
};

const handleResumeRule = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'ResumeRule' }>,
): Promise<readonly DomainEvent[]> => {
  const now = deps.clock.now();
  const event: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: { kind: 'RuleResumed', ruleId: cmd.ruleId, ...(cmd.note ? { note: cmd.note } : {}) },
  };
  await appendAndProject(deps, event);
  return [event];
};

const handleArchiveRule = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'ArchiveRule' }>,
): Promise<readonly DomainEvent[]> => {
  const now = deps.clock.now();
  const event: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: { kind: 'RuleArchived', ruleId: cmd.ruleId, reason: cmd.reason },
  };
  await appendAndProject(deps, event);
  return [event];
};

const handleReverseAction = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'ReverseAction' }>,
): Promise<readonly DomainEvent[]> => {
  const token = await deps.rollback.redeem(cmd.rollbackTokenId);
  const now = deps.clock.now();
  const event: DomainEvent = {
    eventId: mintUlid(() => now),
    subreddit: cmd.subreddit,
    occurredAt: now,
    actor: cmd.actor,
    payload: {
      kind: 'ActionReversed',
      ruleId: token.ruleId,
      originalActionEventId: token.originalEventId,
      thingId: token.thingId,
      ...(cmd.note ? { reasonNote: cmd.note } : {}),
      learningSnapshot: {},
    },
  };
  await appendAndProject(deps, event);
  return [event];
};

const handleCastConsensusVote = async (
  deps: CommandBusDeps,
  cmd: Extract<Command, { kind: 'CastConsensusVote' }>,
): Promise<readonly DomainEvent[]> => {
  await deps.consensus.recordVote({
    subreddit: cmd.subreddit,
    ruleId: cmd.ruleId,
    voter: cmd.actor,
    vote: cmd.vote,
    ...(cmd.note ? { note: cmd.note } : {}),
  });
  return []; // consensus.recordVote already appended the event
};

export const buildCommandBus = (deps: CommandBusDeps) => ({
  dispatch: async (cmd: Command): Promise<readonly DomainEvent[]> => {
    switch (cmd.kind) {
      case 'DraftRule':
        return handleDraftRule(deps, cmd);
      case 'CompileRule':
        return handleCompileRule(deps, cmd);
      case 'ActivateRule':
        return handleActivateRule(deps, cmd);
      case 'PauseRule':
        return handlePauseRule(deps, cmd);
      case 'ResumeRule':
        return handleResumeRule(deps, cmd);
      case 'ArchiveRule':
        return handleArchiveRule(deps, cmd);
      case 'ReverseAction':
        return handleReverseAction(deps, cmd);
      case 'CastConsensusVote':
        return handleCastConsensusVote(deps, cmd);
      case 'AnswerClarification':
      case 'RunWhatIf':
      case 'AmendRule':
      case 'RevertRule':
      case 'ImportTemplate':
        // These are routed to dedicated services on dispatch (compiler,
        // what-if studio, template gallery) — they don't go through the
        // standard event path.
        return [];
    }
  },
});

export type CommandBus = ReturnType<typeof buildCommandBus>;

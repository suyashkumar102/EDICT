import type { DomainEvent } from '@domain/events/DomainEvent';
import { isEventKind } from '@domain/events/DomainEvent';
import type { RuleAggregate, RuleVersionRecord } from '@domain/aggregates/RuleAggregate';
import { buildInitialRule } from '@domain/aggregates/RuleAggregate';
import type { ShadowStatus } from '@domain/values/ShadowStatus';
import type { RuleId } from '@shared/types/BrandedPrimitives';
import { brandRuleId, brandRuleVersion } from '@shared/types/BrandedPrimitives';
import { computeEffectiveness } from '@domain/values/EffectivenessScore';
import { buildConfidence } from '@domain/values/ConfidenceScore';

/**
 * `apply` is the only function that mutates a RuleAggregate's projected
 * state. Given the current aggregate and the next event in the log, it
 * returns the next aggregate. `replay` folds a sequence of events into a
 * final aggregate.
 *
 * Because aggregates are pure data, hydrating from history is just
 * `events.reduce(apply, null)`. The same code path drives both
 * runtime hydration (Redis ZScan) and time-travel queries ("show me the
 * rule as of timestamp X").
 */

export const apply = (state: RuleAggregate | null, event: DomainEvent): RuleAggregate | null => {
  const occurredAt = event.occurredAt;

  if (isEventKind(event, 'RuleDrafted')) {
    if (state) return state; // already drafted
    const initialVersion: RuleVersionRecord = {
      version: brandRuleVersion(1),
      clauses: [],
      author: {
        authoredBy:
          event.actor === 'system'
            ? (brandRuleId('system') as unknown as RuleVersionRecord['author']['authoredBy'])
            : event.actor,
        authoredAt: occurredAt,
        englishSource: event.payload.englishSource,
        compilerConfidence: buildConfidence(0),
        clarificationsAnswered: 0,
      },
      parent: null,
      diffSummary: 'initial draft',
    };
    return buildInitialRule({
      id: event.payload.ruleId,
      subreddit: event.subreddit,
      title: event.payload.title,
      description: event.payload.description,
      initialVersion,
      createdAt: occurredAt,
    });
  }

  if (!state) return null; // event without prior draft is illegal — log will catch this

  if (isEventKind(event, 'RuleCompiled')) {
    const existingVersion = state.versions.find((v) => v.version === event.payload.version);
    const versions: RuleVersionRecord[] = existingVersion
      ? state.versions.map((v) =>
          v.version === event.payload.version
            ? { ...v, clauses: event.payload.clauses, diffSummary: event.payload.diffSummary }
            : v,
        )
      : [
          ...state.versions,
          {
            version: event.payload.version,
            clauses: event.payload.clauses,
            author: {
              authoredBy:
                event.actor === 'system' ? state.versions[0]!.author.authoredBy : event.actor,
              authoredAt: occurredAt,
              englishSource: state.versions[state.versions.length - 1]?.author.englishSource ?? '',
              compilerConfidence: event.payload.confidence,
              clarificationsAnswered: 0,
            },
            parent: state.currentVersion,
            diffSummary: event.payload.diffSummary,
          },
        ];
    return { ...state, versions, currentVersion: event.payload.version, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'RuleActivated')) {
    const nextShadow: ShadowStatus = {
      ...state.shadowStatus,
      phase: event.payload.enteringPhase,
      enteredShadowAt:
        event.payload.enteringPhase === 'shadowed'
          ? occurredAt
          : state.shadowStatus.enteredShadowAt,
      promotedAt:
        event.payload.enteringPhase === 'live' ? occurredAt : state.shadowStatus.promotedAt,
      observations: 0,
      shadowReversals: 0,
      pauseReason: null,
      pausedAt: null,
    };
    return { ...state, shadowStatus: nextShadow, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'ShadowDecisionRecorded')) {
    const nextShadow: ShadowStatus = {
      ...state.shadowStatus,
      observations: state.shadowStatus.observations + 1,
    };
    return { ...state, shadowStatus: nextShadow, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'RulePromoted')) {
    const nextShadow: ShadowStatus = {
      ...state.shadowStatus,
      phase: 'live',
      promotedAt: occurredAt,
      currentConfidence: event.payload.finalConfidence,
    };
    return { ...state, shadowStatus: nextShadow, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'RulePaused')) {
    const nextShadow: ShadowStatus = {
      ...state.shadowStatus,
      phase: 'paused',
      pauseReason: event.payload.reason,
      pausedAt: occurredAt,
    };
    return { ...state, shadowStatus: nextShadow, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'RuleResumed')) {
    const nextShadow: ShadowStatus = {
      ...state.shadowStatus,
      phase: state.shadowStatus.promotedAt ? 'live' : 'shadowed',
      pauseReason: null,
      pausedAt: null,
    };
    return { ...state, shadowStatus: nextShadow, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'RuleArchived')) {
    return {
      ...state,
      archivedAt: occurredAt,
      shadowStatus: { ...state.shadowStatus, phase: 'archived' },
      updatedAt: occurredAt,
    };
  }

  if (isEventKind(event, 'RuleAmended')) {
    const newVersion: RuleVersionRecord = {
      version: event.payload.toVersion,
      clauses: event.payload.clauses,
      author: {
        authoredBy: event.actor === 'system' ? state.versions[0]!.author.authoredBy : event.actor,
        authoredAt: occurredAt,
        englishSource: state.versions[state.versions.length - 1]?.author.englishSource ?? '',
        compilerConfidence: event.payload.confidence,
        clarificationsAnswered: 0,
      },
      parent: event.payload.fromVersion,
      diffSummary: event.payload.diffSummary,
    };
    return {
      ...state,
      versions: [...state.versions, newVersion],
      currentVersion: event.payload.toVersion,
      updatedAt: occurredAt,
    };
  }

  if (isEventKind(event, 'RuleReverted')) {
    return { ...state, currentVersion: event.payload.toVersion, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'ActionTaken')) {
    const hourBucket = Math.floor(occurredAt / (60 * 60 * 1000));
    const sameBucket = hourBucket === state.breaker.currentHourBucket;
    // Increment running match count so Command Center shows live numbers
    // without waiting for the 2-hour effectiveness-recompute scheduler.
    const prevMatches = state.effectiveness?.matches ?? 0;
    const prevReversals = state.effectiveness?.reversals ?? 0;
    const prevPenalties = state.effectiveness?.conflictPenalties ?? 0;
    const updatedEffectiveness = computeEffectiveness({
      matches: prevMatches + 1,
      reversals: prevReversals,
      conflictPenalties: prevPenalties,
      computedAt: occurredAt,
    });
    return {
      ...state,
      effectiveness: updatedEffectiveness,
      breaker: {
        ...state.breaker,
        currentHourBucket: hourBucket,
        hourlyActionCount: sameBucket ? state.breaker.hourlyActionCount + 1 : 1,
      },
      updatedAt: occurredAt,
    };
  }

  if (isEventKind(event, 'CircuitBreakerTripped')) {
    if (event.payload.ruleId !== state.id && event.payload.scope === 'rule') return state;
    return {
      ...state,
      breaker: {
        ...state.breaker,
        tripUntil: event.payload.cooldownUntil,
        tripCount: state.breaker.tripCount + 1,
      },
      shadowStatus: {
        ...state.shadowStatus,
        phase: 'paused',
        pauseReason: 'breaker',
        pausedAt: occurredAt,
      },
      updatedAt: occurredAt,
    };
  }

  if (isEventKind(event, 'ActionReversed')) {
    // Increment reversal count so effectiveness score reflects mod overrides
    const prevMatches = state.effectiveness?.matches ?? 0;
    const prevReversals = state.effectiveness?.reversals ?? 0;
    const prevPenalties = state.effectiveness?.conflictPenalties ?? 0;
    const updatedEffectiveness = computeEffectiveness({
      matches: prevMatches,
      reversals: prevReversals + 1,
      conflictPenalties: prevPenalties,
      computedAt: occurredAt,
    });
    return { ...state, effectiveness: updatedEffectiveness, updatedAt: occurredAt };
  }

  if (isEventKind(event, 'EffectivenessRecomputed')) {
    if (event.payload.ruleId !== state.id) return state;
    const snapshot = computeEffectiveness({
      matches: event.payload.matches,
      reversals: event.payload.reversals,
      conflictPenalties: event.payload.conflictPenalties,
      computedAt: occurredAt,
    });
    return { ...state, effectiveness: snapshot, updatedAt: occurredAt };
  }

  return state;
};

export const replay = (events: readonly DomainEvent[]): RuleAggregate | null => {
  return events.reduce<RuleAggregate | null>((acc, evt) => apply(acc, evt), null);
};

export const replayFiltered = (
  events: readonly DomainEvent[],
  ruleId: RuleId,
): RuleAggregate | null => {
  const relevant = events.filter(
    (e) => 'ruleId' in e.payload && (e.payload as { ruleId: RuleId }).ruleId === ruleId,
  );
  return replay(relevant);
};

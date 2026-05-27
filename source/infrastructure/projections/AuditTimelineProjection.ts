import type { DomainEvent } from '@domain/events/DomainEvent';
import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { auditTimelineKey } from '@infrastructure/redis/KeyNamespacing';
import type {
  RuleId,
  SubredditId,
  ThingId,
  TimestampMs,
  ULID,
} from '@shared/types/BrandedPrimitives';

/**
 * Audit timeline projection. Each entry is a flat record we can render
 * in the Command Center's "Audit" tab without re-hydrating events.
 *
 * Entries fall into three categories the UI filters on:
 *   - lifecycle: RuleDrafted, RuleCompiled, RuleActivated, RulePromoted, RulePaused, …
 *   - action:    ActionTaken, ShadowDecisionRecorded, ActionReversed
 *   - safety:    CircuitBreakerTripped, ConflictDetected, ConsensusVoteCast
 *
 * Storage: ZSet keyed by occurredAt. The cap is 5000 entries per sub,
 * trimmed nightly. Entries older than `rollbackWindowDays` are also
 * eligible for trim; the older the entry, the smaller the UI need.
 */

export type AuditCategory = 'lifecycle' | 'action' | 'safety';

export interface AuditEntry {
  readonly eventId: ULID;
  readonly occurredAt: TimestampMs;
  readonly category: AuditCategory;
  readonly kind: string;
  readonly ruleId: RuleId | null;
  readonly thingId: ThingId | null;
  readonly summary: string;
}

const CATEGORY_OF: Record<string, AuditCategory> = {
  RuleDrafted: 'lifecycle',
  ClarificationRequested: 'lifecycle',
  ClarificationAnswered: 'lifecycle',
  RuleCompiled: 'lifecycle',
  RuleActivated: 'lifecycle',
  RulePromoted: 'lifecycle',
  RulePaused: 'lifecycle',
  RuleResumed: 'lifecycle',
  RuleArchived: 'lifecycle',
  RuleAmended: 'lifecycle',
  RuleReverted: 'lifecycle',
  ShadowDecisionRecorded: 'action',
  ActionTaken: 'action',
  ActionReversed: 'action',
  CircuitBreakerTripped: 'safety',
  CircuitBreakerReset: 'safety',
  ConflictDetected: 'safety',
  ConsensusVoteCast: 'safety',
  BriefingPrepared: 'lifecycle',
  EffectivenessRecomputed: 'lifecycle',
  SuggestionGenerated: 'lifecycle',
  TemplateImported: 'lifecycle',
};

const summarise = (event: DomainEvent): string => {
  const p = event.payload;
  switch (p.kind) {
    case 'RuleDrafted':
      return `Draft: "${p.title}" by ${event.actor}`;
    case 'RuleCompiled':
      return `Compiled v${p.version} (${p.diffSummary}, conf=${p.confidence.toFixed(2)})`;
    case 'RuleActivated':
      return `Activated → ${p.enteringPhase}`;
    case 'RulePromoted':
      return `Promoted to live (reason=${p.reason}, conf=${p.finalConfidence.toFixed(2)})`;
    case 'RulePaused':
      return `Paused (reason=${p.reason}${p.note ? `; ${p.note}` : ''})`;
    case 'ShadowDecisionRecorded':
      return `Shadow: "${p.matchedClauseName}" → would ${p.verdict.kind}`;
    case 'ActionTaken':
      return `Action: ${p.verdict.kind} via "${p.matchedClauseName}"`;
    case 'ActionReversed':
      return `Reversed: ${event.actor} undid ${p.originalActionEventId}`;
    case 'CircuitBreakerTripped':
      return `Breaker ${p.scope} tripped at ${p.actionsInWindow}/${p.ceiling}`;
    case 'CircuitBreakerReset':
      return `Breaker ${p.scope} reset`;
    case 'ConflictDetected':
      return `Conflict ${p.conflictKind}: ${p.description}`;
    case 'ConsensusVoteCast':
      return `Consensus vote: ${p.vote} by ${p.voter}`;
    case 'BriefingPrepared':
      return `Briefing: ${p.actionsTaken} actions, ${p.reversals} reversals`;
    case 'EffectivenessRecomputed':
      return `Effectiveness: ${p.matches - p.reversals} / ${p.matches} (score ${p.score.toFixed(2)})`;
    case 'SuggestionGenerated':
      return `Suggestion: "${p.proposedEnglish.slice(0, 60)}…"`;
    case 'TemplateImported':
      return `Template imported: ${p.templateSlug}`;
    case 'RuleAmended':
      return `Amended v${p.fromVersion} → v${p.toVersion}: ${p.diffSummary}`;
    case 'RuleReverted':
      return `Reverted v${p.fromVersion} → v${p.toVersion}`;
    case 'RuleArchived':
      return `Archived: ${p.reason}`;
    case 'RuleResumed':
      return `Resumed`;
    case 'ClarificationRequested':
      return `Clarify: ${p.question}`;
    case 'ClarificationAnswered':
      return `Clarify answered: ${p.answer.slice(0, 60)}`;
  }
};

export const buildAuditTimelineProjection = (redis: RedisGateway) => ({
  applyEvent: async (event: DomainEvent): Promise<void> => {
    const entry: AuditEntry = {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      category: CATEGORY_OF[event.payload.kind] ?? 'lifecycle',
      kind: event.payload.kind,
      ruleId:
        'ruleId' in event.payload ? ((event.payload as { ruleId: RuleId }).ruleId ?? null) : null,
      thingId:
        'thingId' in event.payload
          ? ((event.payload as { thingId: ThingId }).thingId ?? null)
          : null,
      summary: summarise(event),
    };
    await redis.zadd(auditTimelineKey(event.subreddit), event.occurredAt, JSON.stringify(entry));
  },

  readRecent: async (
    subreddit: SubredditId,
    limit: number,
    categoryFilter?: AuditCategory,
  ): Promise<readonly AuditEntry[]> => {
    const members = await redis.zrange(auditTimelineKey(subreddit), 0, limit * 2 - 1, {
      rev: true,
    });
    const parsed = members.map((m) => JSON.parse(m) as AuditEntry);
    const filtered = categoryFilter ? parsed.filter((e) => e.category === categoryFilter) : parsed;
    return filtered.slice(0, limit);
  },

  readForRule: async (
    subreddit: SubredditId,
    ruleId: RuleId,
    limit: number,
  ): Promise<readonly AuditEntry[]> => {
    const members = await redis.zrange(auditTimelineKey(subreddit), 0, -1, { rev: true });
    const parsed = members
      .map((m) => JSON.parse(m) as AuditEntry)
      .filter((e) => e.ruleId === ruleId);
    return parsed.slice(0, limit);
  },

  trimBefore: async (subreddit: SubredditId, cutoff: TimestampMs): Promise<number> => {
    return redis.zremRangeByScore(
      auditTimelineKey(subreddit),
      Number.NEGATIVE_INFINITY,
      cutoff - 1,
    );
  },
});

export type AuditTimelineProjection = ReturnType<typeof buildAuditTimelineProjection>;

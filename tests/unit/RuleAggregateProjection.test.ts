import { describe, expect, it } from 'vitest';
import { apply, replay } from '@domain/aggregates/RuleAggregateProjection';
import type { DomainEvent } from '@domain/events/DomainEvent';
import {
  brandModeratorId,
  brandRuleId,
  brandRuleVersion,
  brandSubredditId,
  brandTimestampMs,
  brandULID,
} from '@shared/types/BrandedPrimitives';
import { buildConfidence } from '@domain/values/ConfidenceScore';

const SUB = brandSubredditId('s');
const MOD = brandModeratorId('m');
const RULE = brandRuleId('rule-1');

const at = (offset: number) => brandTimestampMs(1_700_000_000_000 + offset);
const ulid = (n: number) =>
  brandULID('01ABCDEFGHIJKLMNOPQRSTUV' + (n % 100).toString().padStart(2, '0'));

const draft = (offset = 0): DomainEvent => ({
  eventId: ulid(offset),
  subreddit: SUB,
  occurredAt: at(offset),
  actor: MOD,
  payload: {
    kind: 'RuleDrafted',
    ruleId: RULE,
    englishSource: 'lock all caps',
    title: 'Lock all caps',
    description: 'discourages shouting',
  },
});

const compiled = (offset: number, version = 2): DomainEvent => ({
  eventId: ulid(offset),
  subreddit: SUB,
  occurredAt: at(offset),
  actor: MOD,
  payload: {
    kind: 'RuleCompiled',
    ruleId: RULE,
    version: brandRuleVersion(version),
    clauses: [
      {
        clauseName: 'caps',
        when: {
          kind: 'atom',
          fact: 'titleAllCaps',
          comparator: { kind: 'isTrue' },
          atomId: 'CAPS01',
        },
        verdict: { kind: 'lock' },
      },
    ],
    confidence: buildConfidence(0.95),
    diffSummary: 'initial compile',
  },
});

const activated = (offset: number, phase: 'shadowed' | 'live' = 'shadowed'): DomainEvent => ({
  eventId: ulid(offset),
  subreddit: SUB,
  occurredAt: at(offset),
  actor: MOD,
  payload: {
    kind: 'RuleActivated',
    ruleId: RULE,
    version: brandRuleVersion(2),
    enteringPhase: phase,
  },
});

describe('RuleAggregateProjection.apply', () => {
  it('drafts a new aggregate when applied to null state', () => {
    const result = apply(null, draft(1));
    expect(result).not.toBeNull();
    expect(result?.id).toBe(RULE);
    expect(result?.shadowStatus.phase).toBe('drafted');
  });

  it('does not double-draft', () => {
    const first = apply(null, draft(1));
    const second = apply(first, draft(2));
    expect(second).toBe(first);
  });

  it('compiling adds a new version and bumps currentVersion', () => {
    const drafted = apply(null, draft(1));
    const compiledState = apply(drafted, compiled(2, 2));
    expect(compiledState?.versions).toHaveLength(2);
    expect(compiledState?.currentVersion).toBe(2);
  });

  it('activating sets the shadow phase', () => {
    const drafted = apply(null, draft(1));
    const compiledState = apply(drafted, compiled(2, 2));
    const activatedState = apply(compiledState, activated(3));
    expect(activatedState?.shadowStatus.phase).toBe('shadowed');
    expect(activatedState?.shadowStatus.enteredShadowAt).toBe(at(3));
  });

  it('replay folds a sequence of events into the final state', () => {
    const result = replay([draft(1), compiled(2, 2), activated(3)]);
    expect(result?.shadowStatus.phase).toBe('shadowed');
    expect(result?.currentVersion).toBe(2);
    expect(result?.versions).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { buildInMemoryRedisGateway } from '@infrastructure/redis/RedisGateway';
import { buildRedisEventStore } from '@infrastructure/eventstore/RedisEventStore';
import {
  brandModeratorId,
  brandRuleId,
  brandRuleVersion,
  brandSubredditId,
  brandTimestampMs,
  brandULID,
} from '@shared/types/BrandedPrimitives';
import { buildConfidence } from '@domain/values/ConfidenceScore';
import type { DomainEvent } from '@domain/events/DomainEvent';

const SUBREDDIT = brandSubredditId('testsub');
const ACTOR = brandModeratorId('mod-alice');

const draftEvent = (offset: number): DomainEvent => ({
  eventId: brandULID('01AAAAAAAAAAAAAAAAAAAAAAA' + String(offset).padStart(1, '0')),
  subreddit: SUBREDDIT,
  occurredAt: brandTimestampMs(1_700_000_000_000 + offset),
  actor: ACTOR,
  payload: {
    kind: 'RuleDrafted',
    ruleId: brandRuleId(`rule-${offset}`),
    englishSource: 'lock all caps',
    title: `Rule ${offset}`,
    description: 'description for rule',
  },
});

const compiledEvent = (offset: number): DomainEvent => ({
  eventId: brandULID('01BBBBBBBBBBBBBBBBBBBBBBB' + String(offset).padStart(1, '0')),
  subreddit: SUBREDDIT,
  occurredAt: brandTimestampMs(1_700_000_000_000 + offset + 100),
  actor: ACTOR,
  payload: {
    kind: 'RuleCompiled',
    ruleId: brandRuleId(`rule-${offset}`),
    version: brandRuleVersion(2),
    clauses: [],
    confidence: buildConfidence(0.92),
    diffSummary: 'initial compile',
  },
});

describe('RedisEventStore round-trip', () => {
  it('appends and reads events back in time order', async () => {
    const store = buildRedisEventStore(buildInMemoryRedisGateway());
    await store.append(draftEvent(1));
    await store.append(draftEvent(2));
    await store.append(compiledEvent(1));

    const window = await store.readWindow({
      subreddit: SUBREDDIT,
      fromInclusive: brandTimestampMs(0),
      toExclusive: brandTimestampMs(1_700_000_000_000 + 1000),
    });
    expect(window).toHaveLength(3);
    expect(window[0]?.payload.kind).toBe('RuleDrafted');
    expect(window[1]?.payload.kind).toBe('RuleDrafted');
    expect(window[2]?.payload.kind).toBe('RuleCompiled');
  });

  it('readBefore returns events strictly before the cutoff', async () => {
    const store = buildRedisEventStore(buildInMemoryRedisGateway());
    await store.append(draftEvent(1));
    await store.append(draftEvent(100));

    const before = await store.readBefore({
      subreddit: SUBREDDIT,
      beforeExclusive: brandTimestampMs(1_700_000_000_000 + 50),
    });
    expect(before).toHaveLength(1);
    expect(before[0]?.occurredAt).toBe(1_700_000_000_000 + 1);
  });

  it('size returns the count of stored events', async () => {
    const store = buildRedisEventStore(buildInMemoryRedisGateway());
    expect(await store.size(SUBREDDIT)).toBe(0);
    await store.append(draftEvent(1));
    expect(await store.size(SUBREDDIT)).toBe(1);
    await store.append(draftEvent(2));
    expect(await store.size(SUBREDDIT)).toBe(2);
  });
});

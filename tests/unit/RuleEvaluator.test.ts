import { describe, expect, it } from 'vitest';
import { evaluateRule, evaluateRuleSet } from '@evaluation/RuleEvaluator';
import type { CompiledRule } from '@compilation/schema/RuleSchema';
import { brandRuleId, brandThingId, brandTimestampMs } from '@shared/types/BrandedPrimitives';
import { buildEmptyFactBag, withFact } from '@evaluation/factbag/FactBag';

const ruleWith = (clauses: CompiledRule['clauses']): CompiledRule => ({
  schemaVersion: 1,
  title: 'test',
  description: 'test',
  englishSource: 'test',
  clauses,
  compilerConfidence: 1,
});

const bagWith = (slots: Record<string, string | number | boolean>) => {
  let b = buildEmptyFactBag(brandThingId('t3_test'), brandTimestampMs(0));
  for (const [k, v] of Object.entries(slots)) {
    b = withFact(b, k as never, v);
  }
  return b;
};

describe('RuleEvaluator.evaluateRule', () => {
  it('fires the first matching clause and short-circuits', () => {
    const rule = ruleWith([
      {
        clauseName: 'first',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'lt', value: 100 },
          atomId: 'A1',
        },
        verdict: { kind: 'sendToModQueue' },
      },
      {
        clauseName: 'second',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'lt', value: 50 },
          atomId: 'A2',
        },
        verdict: { kind: 'remove', spam: false },
      },
    ]);
    const result = evaluateRule(brandRuleId('rule-x'), rule, bagWith({ postLengthChars: 30 }));
    expect(result).not.toBeNull();
    expect(result?.matchedClauseName).toBe('first');
    expect(result?.verdict.kind).toBe('sendToModQueue');
  });

  it('respects UNLESS — clause does not fire if exception matches', () => {
    const rule = ruleWith([
      {
        clauseName: 'short post',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'lt', value: 50 },
          atomId: 'W1',
        },
        unless: {
          kind: 'atom',
          fact: 'authorKarma',
          comparator: { kind: 'gt', value: 1000 },
          atomId: 'U1',
        },
        verdict: { kind: 'sendToModQueue' },
      },
    ]);
    const matched = evaluateRule(
      brandRuleId('r'),
      rule,
      bagWith({ postLengthChars: 30, authorKarma: 500 }),
    );
    expect(matched?.matchedClauseName).toBe('short post');

    const exempted = evaluateRule(
      brandRuleId('r'),
      rule,
      bagWith({ postLengthChars: 30, authorKarma: 9999 }),
    );
    expect(exempted).toBeNull();
  });

  it('produces null when no clause matches', () => {
    const rule = ruleWith([
      {
        clauseName: 'long post',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'gt', value: 1000 },
          atomId: 'A1',
        },
        verdict: { kind: 'sendToModQueue' },
      },
    ]);
    expect(evaluateRule(brandRuleId('r'), rule, bagWith({ postLengthChars: 30 }))).toBeNull();
  });

  it('explanation trace records the matched clause name and verdict', () => {
    const rule = ruleWith([
      {
        clauseName: 'all-caps',
        when: {
          kind: 'atom',
          fact: 'titleAllCaps',
          comparator: { kind: 'isTrue' },
          atomId: 'CAPS01',
        },
        verdict: { kind: 'lock' },
      },
    ]);
    const result = evaluateRule(brandRuleId('r'), rule, bagWith({ titleAllCaps: true }));
    expect(result?.explanation.shortLine).toContain('all-caps');
    expect(result?.explanation.fullTrace.join('\n')).toContain('CAPS01');
  });
});

describe('RuleEvaluator.evaluateRuleSet', () => {
  it('returns the first rule that fires; collects others as secondaryMatches', () => {
    const ruleA = ruleWith([
      {
        clauseName: 'A',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'lt', value: 50 },
          atomId: 'A1',
        },
        verdict: { kind: 'lock' },
      },
    ]);
    const ruleB = ruleWith([
      {
        clauseName: 'B',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'lt', value: 100 },
          atomId: 'B1',
        },
        verdict: { kind: 'sendToModQueue' },
      },
    ]);
    const result = evaluateRuleSet(
      [
        { ruleId: brandRuleId('A'), rule: ruleA, shadowed: false },
        { ruleId: brandRuleId('B'), rule: ruleB, shadowed: false },
      ],
      bagWith({ postLengthChars: 20 }),
    );
    expect(result.verdict?.ruleId).toBe('A');
    expect(result.secondaryMatches).toHaveLength(1);
    expect(result.secondaryMatches[0]?.ruleId).toBe('B');
  });

  it('flags shadowOnly when the primary verdict came from a shadowed rule', () => {
    const ruleA = ruleWith([
      {
        clauseName: 'A',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'lt', value: 50 },
          atomId: 'A1',
        },
        verdict: { kind: 'lock' },
      },
    ]);
    const result = evaluateRuleSet(
      [{ ruleId: brandRuleId('A'), rule: ruleA, shadowed: true }],
      bagWith({ postLengthChars: 20 }),
    );
    expect(result.shadowOnly).toBe(true);
  });

  it('returns null verdict when no rules match', () => {
    const ruleA = ruleWith([
      {
        clauseName: 'A',
        when: {
          kind: 'atom',
          fact: 'postLengthChars',
          comparator: { kind: 'gt', value: 5000 },
          atomId: 'A1',
        },
        verdict: { kind: 'lock' },
      },
    ]);
    const result = evaluateRuleSet(
      [{ ruleId: brandRuleId('A'), rule: ruleA, shadowed: false }],
      bagWith({ postLengthChars: 30 }),
    );
    expect(result.verdict).toBeNull();
  });
});

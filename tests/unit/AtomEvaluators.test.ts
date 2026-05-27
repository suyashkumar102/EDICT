import { describe, expect, it } from 'vitest';
import type { ConditionAtom } from '@domain/values/RuleClause';
import { evaluateAtom } from '@evaluation/conditions/AtomEvaluators';
import { buildEmptyFactBag, withFact } from '@evaluation/factbag/FactBag';
import { brandThingId, brandTimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Exhaustive per-fact + per-comparator coverage for the atom evaluators.
 * The fact-bag → comparator dispatch is the foundation every rule
 * eventually rests on, and a regression here changes every active
 * rule's behaviour silently.
 */

const T1 = brandThingId('t3_test');
const T0 = brandTimestampMs(0);
const empty = (): ReturnType<typeof buildEmptyFactBag> => buildEmptyFactBag(T1, T0);

const atom = (over: Partial<ConditionAtom>): ConditionAtom => ({
  kind: 'atom',
  fact: 'postLengthChars',
  comparator: { kind: 'lt', value: 50 },
  atomId: 'ATOM000001',
  ...over,
});

describe('numeric evaluators', () => {
  it('postLengthChars lt — match', () => {
    const bag = withFact(empty(), 'postLengthChars', 30);
    expect(
      evaluateAtom(atom({ fact: 'postLengthChars', comparator: { kind: 'lt', value: 50 } }), bag)
        .matched,
    ).toBe(true);
  });

  it('postLengthChars lt — no match', () => {
    const bag = withFact(empty(), 'postLengthChars', 80);
    expect(
      evaluateAtom(atom({ fact: 'postLengthChars', comparator: { kind: 'lt', value: 50 } }), bag)
        .matched,
    ).toBe(false);
  });

  it('accountAgeDays gte — boundary inclusive', () => {
    const bag = withFact(empty(), 'accountAgeDays', 7);
    expect(
      evaluateAtom(atom({ fact: 'accountAgeDays', comparator: { kind: 'gte', value: 7 } }), bag)
        .matched,
    ).toBe(true);
  });

  it('authorKarma between — inside range', () => {
    const bag = withFact(empty(), 'authorKarma', 50);
    expect(
      evaluateAtom(
        atom({ fact: 'authorKarma', comparator: { kind: 'between', min: 10, max: 100 } }),
        bag,
      ).matched,
    ).toBe(true);
  });

  it('authorKarma between — below range', () => {
    const bag = withFact(empty(), 'authorKarma', 5);
    expect(
      evaluateAtom(
        atom({ fact: 'authorKarma', comparator: { kind: 'between', min: 10, max: 100 } }),
        bag,
      ).matched,
    ).toBe(false);
  });

  it('missing fact returns measurable=false, matched=false', () => {
    const result = evaluateAtom(
      atom({ fact: 'postScoreAfterMinutes', comparator: { kind: 'lt', value: 0 } }),
      empty(),
    );
    expect(result.matched).toBe(false);
    expect(result.measurable).toBe(false);
  });

  it('wrong-type fact (number expected, boolean present) returns measurable=false', () => {
    const bag = withFact(empty(), 'postLengthChars', true as never);
    const result = evaluateAtom(
      atom({ fact: 'postLengthChars', comparator: { kind: 'lt', value: 50 } }),
      bag,
    );
    expect(result.matched).toBe(false);
    expect(result.measurable).toBe(false);
  });
});

describe('boolean evaluators', () => {
  it('titleAllCaps isTrue — match', () => {
    const bag = withFact(empty(), 'titleAllCaps', true);
    expect(
      evaluateAtom(atom({ fact: 'titleAllCaps', comparator: { kind: 'isTrue' } }), bag).matched,
    ).toBe(true);
  });

  it('titleAllCaps isTrue — no match (false)', () => {
    const bag = withFact(empty(), 'titleAllCaps', false);
    expect(
      evaluateAtom(atom({ fact: 'titleAllCaps', comparator: { kind: 'isTrue' } }), bag).matched,
    ).toBe(false);
  });

  it('authorVerifiedEmail isFalse — match when false', () => {
    const bag = withFact(empty(), 'authorVerifiedEmail', false);
    expect(
      evaluateAtom(atom({ fact: 'authorVerifiedEmail', comparator: { kind: 'isFalse' } }), bag)
        .matched,
    ).toBe(true);
  });

  it('hasLink eq false — match (treated as boolean equality)', () => {
    const bag = withFact(empty(), 'hasLink', false);
    expect(
      evaluateAtom(atom({ fact: 'hasLink', comparator: { kind: 'eq', value: false } }), bag)
        .matched,
    ).toBe(true);
  });
});

describe('string evaluators', () => {
  it('titleMatchesPattern matches — literal hit', () => {
    const bag = withFact(empty(), 'titleMatchesPattern', 'spam example');
    expect(
      evaluateAtom(
        atom({
          fact: 'titleMatchesPattern',
          comparator: { kind: 'matches', pattern: '^spam', caseSensitive: false },
        }),
        bag,
      ).matched,
    ).toBe(true);
  });

  it('titleMatchesPattern matches — case-sensitive miss', () => {
    const bag = withFact(empty(), 'titleMatchesPattern', 'SPAM example');
    expect(
      evaluateAtom(
        atom({
          fact: 'titleMatchesPattern',
          comparator: { kind: 'matches', pattern: '^spam', caseSensitive: true },
        }),
        bag,
      ).matched,
    ).toBe(false);
  });

  it('titleMatchesPattern matches — unsafe regex fails closed', () => {
    const bag = withFact(empty(), 'titleMatchesPattern', 'aaaaaaaaaab');
    expect(
      evaluateAtom(
        atom({
          fact: 'titleMatchesPattern',
          comparator: { kind: 'matches', pattern: '(a+)+', caseSensitive: false },
        }),
        bag,
      ).matched,
    ).toBe(false);
  });
});

describe('array-in evaluators', () => {
  it('domainEqualsAnyOf — matches any', () => {
    const bag = withFact(empty(), 'domainEqualsAnyOf', ['bit.ly', 'short.url']);
    expect(
      evaluateAtom(
        atom({
          fact: 'domainEqualsAnyOf',
          comparator: { kind: 'in', values: ['bit.ly', 'tinyurl.com'] },
        }),
        bag,
      ).matched,
    ).toBe(true);
  });

  it('domainEqualsAnyOf — no match', () => {
    const bag = withFact(empty(), 'domainEqualsAnyOf', ['neutral.example']);
    expect(
      evaluateAtom(
        atom({
          fact: 'domainEqualsAnyOf',
          comparator: { kind: 'in', values: ['bit.ly', 'tinyurl.com'] },
        }),
        bag,
      ).matched,
    ).toBe(false);
  });

  it('flairEqualsAnyOf string in — matches', () => {
    const bag = withFact(empty(), 'flairEqualsAnyOf', 'announce');
    expect(
      evaluateAtom(
        atom({
          fact: 'flairEqualsAnyOf',
          comparator: { kind: 'in', values: ['announce', 'meta'] },
        }),
        bag,
      ).matched,
    ).toBe(true);
  });
});

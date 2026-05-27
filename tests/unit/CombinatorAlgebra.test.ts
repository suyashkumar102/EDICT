import { describe, expect, it } from 'vitest';
import { evaluateTree, normalize } from '@evaluation/combinators/CombinatorAlgebra';
import type { ConditionAtom, ConditionTree } from '@domain/values/RuleClause';
import type { FactBag } from '@evaluation/factbag/FactBag';
import { buildEmptyFactBag, withFact } from '@evaluation/factbag/FactBag';
import { brandThingId, brandTimestampMs } from '@shared/types/BrandedPrimitives';

const bag = (overrides: Partial<Record<string, string | number | boolean>>): FactBag => {
  let b = buildEmptyFactBag(brandThingId('t3_aaa'), brandTimestampMs(0));
  for (const [k, v] of Object.entries(overrides)) {
    b = withFact(b, k as never, v as never);
  }
  return b;
};

const atom = (
  fact: string,
  comparator: ConditionAtom['comparator'],
  id = 'ATOM01',
): ConditionAtom => ({
  kind: 'atom',
  fact: fact as ConditionAtom['fact'],
  comparator,
  atomId: id,
});

describe('CombinatorAlgebra.evaluateTree', () => {
  it('matches atom when comparator passes', () => {
    const trace = evaluateTree(
      atom('postLengthChars', { kind: 'lt', value: 50 }),
      bag({ postLengthChars: 30 }),
    );
    expect(trace.matched).toBe(true);
  });

  it('fails atom when fact is missing', () => {
    const trace = evaluateTree(atom('postLengthChars', { kind: 'lt', value: 50 }), bag({}));
    expect(trace.matched).toBe(false);
  });

  it('AND short-circuits on first false child', () => {
    const tree: ConditionTree = {
      kind: 'and',
      children: [
        atom('postLengthChars', { kind: 'lt', value: 50 }, 'A1'),
        atom('accountAgeDays', { kind: 'lt', value: 7 }, 'A2'),
      ],
    };
    const trace = evaluateTree(tree, bag({ postLengthChars: 100, accountAgeDays: 5 }));
    expect(trace.matched).toBe(false);
    // short-circuit means the second atom doesn't appear in the trace
    const allLines = trace.lines.join('\n');
    expect(allLines).toContain('A1');
    expect(allLines).not.toContain('A2');
  });

  it('OR short-circuits on first true child', () => {
    const tree: ConditionTree = {
      kind: 'or',
      children: [
        atom('postLengthChars', { kind: 'lt', value: 50 }, 'O1'),
        atom('accountAgeDays', { kind: 'lt', value: 7 }, 'O2'),
      ],
    };
    const trace = evaluateTree(tree, bag({ postLengthChars: 30, accountAgeDays: 90 }));
    expect(trace.matched).toBe(true);
    const allLines = trace.lines.join('\n');
    expect(allLines).toContain('O1');
    expect(allLines).not.toContain('O2');
  });

  it('NOT inverts its child', () => {
    const tree: ConditionTree = {
      kind: 'not',
      child: atom('titleAllCaps', { kind: 'isTrue' }, 'N1'),
    };
    expect(evaluateTree(tree, bag({ titleAllCaps: false })).matched).toBe(true);
    expect(evaluateTree(tree, bag({ titleAllCaps: true })).matched).toBe(false);
  });

  it('nested AND/OR/NOT evaluates correctly', () => {
    // (postLen < 50 AND age < 7) OR (NOT verifiedEmail)
    const tree: ConditionTree = {
      kind: 'or',
      children: [
        {
          kind: 'and',
          children: [
            atom('postLengthChars', { kind: 'lt', value: 50 }, 'X1'),
            atom('accountAgeDays', { kind: 'lt', value: 7 }, 'X2'),
          ],
        },
        { kind: 'not', child: atom('authorVerifiedEmail', { kind: 'isTrue' }, 'X3') },
      ],
    };
    expect(
      evaluateTree(tree, bag({ postLengthChars: 30, accountAgeDays: 1, authorVerifiedEmail: true }))
        .matched,
    ).toBe(true);
    expect(
      evaluateTree(
        tree,
        bag({ postLengthChars: 200, accountAgeDays: 100, authorVerifiedEmail: false }),
      ).matched,
    ).toBe(true);
    expect(
      evaluateTree(
        tree,
        bag({ postLengthChars: 200, accountAgeDays: 100, authorVerifiedEmail: true }),
      ).matched,
    ).toBe(false);
  });
});

describe('CombinatorAlgebra.normalize', () => {
  it('collapses not(not(x)) to x', () => {
    const inner = atom('titleAllCaps', { kind: 'isTrue' });
    const tree: ConditionTree = { kind: 'not', child: { kind: 'not', child: inner } };
    expect(normalize(tree)).toEqual(inner);
  });

  it('flattens nested same-kind combinators', () => {
    const a = atom('postLengthChars', { kind: 'lt', value: 50 }, 'A1');
    const b = atom('accountAgeDays', { kind: 'lt', value: 7 }, 'A2');
    const c = atom('authorKarma', { kind: 'lt', value: 100 }, 'A3');
    const tree: ConditionTree = {
      kind: 'and',
      children: [{ kind: 'and', children: [a, b] }, c],
    };
    const result = normalize(tree);
    expect(result.kind).toBe('and');
    expect((result as unknown as { children: ConditionTree[] }).children).toHaveLength(3);
  });

  it('preserves atoms unchanged', () => {
    const a = atom('postLengthChars', { kind: 'lt', value: 50 });
    expect(normalize(a)).toEqual(a);
  });
});

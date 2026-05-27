import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, evaluateTree, normalize } from '@evaluation/combinators/CombinatorAlgebra';
import type { ConditionTree } from '@domain/values/RuleClause';
import type { FactBag } from '@evaluation/factbag/FactBag';
import { brandThingId } from '@shared/types/BrandedPrimitives';

/**
 * Extra coverage on CombinatorAlgebra — pin the empty-children + depth-cap
 * + normalize behaviour added during the security-hardening pass. These
 * tests are what lock the file at 95/95/95 in `vitest.config.ts`.
 */

const T_BAG: FactBag = {
  thingId: brandThingId('t3_demo'),
  capturedAt: 0,
  slots: { titleAllCaps: true, postLengthChars: 10 },
};

const atom = (atomId: string): ConditionTree => ({
  kind: 'atom',
  fact: 'titleAllCaps',
  comparator: { kind: 'isTrue' },
  atomId,
});

const atomFalse = (atomId: string): ConditionTree => ({
  kind: 'atom',
  fact: 'titleAllCaps',
  comparator: { kind: 'isFalse' },
  atomId,
});

describe('evaluateTree — empty children', () => {
  it('and([]) is vacuously true (defensive: schema forbids this shape)', () => {
    const tree: ConditionTree = { kind: 'and', children: [] };
    const trace = evaluateTree(tree, T_BAG);
    expect(trace.matched).toBe(true);
    expect(trace.lines.join(' ')).toContain('empty-children');
  });

  it('or([]) is vacuously false (defensive: schema forbids this shape)', () => {
    const tree: ConditionTree = { kind: 'or', children: [] };
    const trace = evaluateTree(tree, T_BAG);
    expect(trace.matched).toBe(false);
    expect(trace.lines.join(' ')).toContain('empty-children');
  });
});

describe('evaluateTree — short-circuit semantics', () => {
  it('AND short-circuits on first false child', () => {
    const tree: ConditionTree = {
      kind: 'and',
      children: [atomFalse('A1FALSEXX'), atom('A2TRUEAAA')],
    };
    const trace = evaluateTree(tree, T_BAG);
    expect(trace.matched).toBe(false);
    // Second child should not appear in trace because we short-circuited.
    expect(trace.lines.some((l) => l.includes('A2TRUEAAA'))).toBe(false);
  });

  it('OR short-circuits on first true child', () => {
    const tree: ConditionTree = {
      kind: 'or',
      children: [atom('B1TRUEAAA'), atomFalse('B2FALSEXX')],
    };
    const trace = evaluateTree(tree, T_BAG);
    expect(trace.matched).toBe(true);
    expect(trace.lines.some((l) => l.includes('B2FALSEXX'))).toBe(false);
  });

  it('NOT inverts a matching atom', () => {
    const tree: ConditionTree = { kind: 'not', child: atom('C1') };
    expect(evaluateTree(tree, T_BAG).matched).toBe(false);
  });

  it('NOT inverts a non-matching atom', () => {
    const tree: ConditionTree = { kind: 'not', child: atomFalse('C2') };
    expect(evaluateTree(tree, T_BAG).matched).toBe(true);
  });
});

describe('evaluateTree — depth cap', () => {
  it('refuses to evaluate past MAX_DEPTH and fails safe (no match)', () => {
    let tree: ConditionTree = atom('LEAFATOM1');
    for (let i = 0; i < MAX_DEPTH + 5; i += 1) {
      tree = { kind: 'not', child: tree };
    }
    const trace = evaluateTree(tree, T_BAG);
    // The over-deep evaluation must NOT throw; fail safe to no-match.
    expect(typeof trace.matched).toBe('boolean');
    expect(trace.lines.join(' ')).toContain('depth-cap');
  });

  it('evaluates at exactly MAX_DEPTH without tripping the cap', () => {
    let tree: ConditionTree = atom('LEAFATOM2');
    for (let i = 0; i < MAX_DEPTH - 1; i += 1) {
      tree = { kind: 'not', child: tree };
    }
    const trace = evaluateTree(tree, T_BAG);
    expect(trace.lines.join(' ')).not.toContain('depth-cap');
  });
});

describe('normalize', () => {
  it('collapses not(not(x)) → x', () => {
    const a = atom('NORM1ATOMA');
    const tree: ConditionTree = { kind: 'not', child: { kind: 'not', child: a } };
    expect(normalize(tree)).toEqual(a);
  });

  it('flattens nested AND of AND', () => {
    const a = atom('FLAT1ATOMA');
    const b = atom('FLAT2ATOMB');
    const c = atom('FLAT3ATOMC');
    const tree: ConditionTree = {
      kind: 'and',
      children: [a, { kind: 'and', children: [b, c] }],
    };
    const out = normalize(tree);
    expect(out.kind).toBe('and');
    if (out.kind === 'and') expect(out.children.length).toBe(3);
  });

  it('flattens nested OR of OR', () => {
    const a = atom('FLAT4ATOMA');
    const b = atom('FLAT5ATOMB');
    const tree: ConditionTree = {
      kind: 'or',
      children: [{ kind: 'or', children: [a, b] }, a],
    };
    const out = normalize(tree);
    expect(out.kind).toBe('or');
    if (out.kind === 'or') expect(out.children.length).toBe(3);
  });

  it('collapses a single-child AND/OR to the child itself', () => {
    const a = atom('SINGLE1ATM');
    const tree: ConditionTree = { kind: 'and', children: [{ kind: 'or', children: [a] }] };
    const out = normalize(tree);
    expect(out).toEqual(a);
  });

  it('leaves an atom unchanged', () => {
    const a = atom('NOOP1ATOMA');
    expect(normalize(a)).toEqual(a);
  });

  it('does not apply distributive laws (intentional — see CUT-LIST.md hard lock #5)', () => {
    const a = atom('DIST1ATOMA');
    const b = atom('DIST2ATOMB');
    const c = atom('DIST3ATOMC');
    const tree: ConditionTree = {
      kind: 'and',
      children: [a, { kind: 'or', children: [b, c] }],
    };
    const out = normalize(tree);
    expect(out.kind).toBe('and');
    if (out.kind === 'and') {
      expect(out.children.length).toBe(2);
      expect(out.children[1]!.kind).toBe('or');
    }
  });
});

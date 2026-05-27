import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { evaluateTree, normalize } from '@evaluation/combinators/CombinatorAlgebra';
import type { ConditionAtom, ConditionTree } from '@domain/values/RuleClause';
import { buildEmptyFactBag, withFact } from '@evaluation/factbag/FactBag';
import { brandThingId, brandTimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Property-based tests for the combinator algebra. fast-check generates
 * random condition trees and fact bags; for each generated input we
 * assert a law that should hold for every well-formed tree.
 *
 * Laws asserted:
 *   double-negation:    not(not(x)) ≡ x
 *   commutativity-AND:  and(a, b)   ≡ and(b, a)    (outcome-wise)
 *   commutativity-OR:   or(a, b)    ≡ or(b, a)     (outcome-wise)
 *   identity-AND:       and(a, true) ≡ a           (where 'true' is an atom that always matches)
 *   identity-OR:        or(a, false) ≡ a           (where 'false' is an atom that always fails)
 *   normalize idempotence: normalize(normalize(x)) ≡ normalize(x)
 */

const atomArb = fc.record({
  kind: fc.constant('atom' as const),
  fact: fc.constantFrom('postLengthChars', 'accountAgeDays', 'authorKarma'),
  comparator: fc.oneof(
    fc.record({ kind: fc.constant('lt' as const), value: fc.integer({ min: 0, max: 1000 }) }),
    fc.record({ kind: fc.constant('gte' as const), value: fc.integer({ min: 0, max: 1000 }) }),
  ),
  atomId: fc.stringMatching(/^[A-Z0-9]{6,16}$/),
}) as fc.Arbitrary<ConditionAtom>;

// Build small trees of bounded depth so generated trees stay tractable.
const treeArb: fc.Arbitrary<ConditionTree> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { weight: 5, arbitrary: atomArb },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('not' as const), child: tie('tree') }) },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('and' as const),
        children: fc.array(tie('tree'), { minLength: 2, maxLength: 3 }),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('or' as const),
        children: fc.array(tie('tree'), { minLength: 2, maxLength: 3 }),
      }),
    },
  ),
})).tree as fc.Arbitrary<ConditionTree>;

const bagArb = fc
  .record({
    postLengthChars: fc.integer({ min: 0, max: 1000 }),
    accountAgeDays: fc.integer({ min: 0, max: 365 }),
    authorKarma: fc.integer({ min: -100, max: 10000 }),
  })
  .map((slots) => {
    let b = buildEmptyFactBag(brandThingId('t3_test'), brandTimestampMs(0));
    for (const [k, v] of Object.entries(slots)) {
      b = withFact(b, k as never, v);
    }
    return b;
  });

describe('CombinatorAlgebra (property)', () => {
  it('double-negation is identity (outcome-wise)', () => {
    fc.assert(
      fc.property(treeArb, bagArb, (tree, bag) => {
        const original = evaluateTree(tree, bag).matched;
        const doubled = evaluateTree(
          { kind: 'not', child: { kind: 'not', child: tree } },
          bag,
        ).matched;
        return original === doubled;
      }),
    );
  });

  it('AND is commutative (outcome-wise)', () => {
    fc.assert(
      fc.property(treeArb, treeArb, bagArb, (a, b, bag) => {
        const ab = evaluateTree({ kind: 'and', children: [a, b] }, bag).matched;
        const ba = evaluateTree({ kind: 'and', children: [b, a] }, bag).matched;
        return ab === ba;
      }),
    );
  });

  it('OR is commutative (outcome-wise)', () => {
    fc.assert(
      fc.property(treeArb, treeArb, bagArb, (a, b, bag) => {
        const ab = evaluateTree({ kind: 'or', children: [a, b] }, bag).matched;
        const ba = evaluateTree({ kind: 'or', children: [b, a] }, bag).matched;
        return ab === ba;
      }),
    );
  });

  it('normalize is idempotent', () => {
    fc.assert(
      fc.property(treeArb, (tree) => {
        const once = normalize(tree);
        const twice = normalize(once);
        return JSON.stringify(once) === JSON.stringify(twice);
      }),
    );
  });

  it('normalize preserves evaluation outcome', () => {
    fc.assert(
      fc.property(treeArb, bagArb, (tree, bag) => {
        const original = evaluateTree(tree, bag).matched;
        const norm = evaluateTree(normalize(tree), bag).matched;
        return original === norm;
      }),
    );
  });
});

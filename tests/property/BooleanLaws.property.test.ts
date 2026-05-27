import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { evaluateTree, normalize } from '@evaluation/combinators/CombinatorAlgebra';
import type { ConditionAtom, ConditionTree } from '@domain/values/RuleClause';
import { buildEmptyFactBag, withFact } from '@evaluation/factbag/FactBag';
import { brandThingId, brandTimestampMs } from '@shared/types/BrandedPrimitives';

/**
 * Additional boolean-algebra laws asserted as fast-check properties.
 *
 * What these add over `CombinatorAlgebra.property.test.ts`:
 *   - De Morgan's laws (not(and) ≡ or(not), not(or) ≡ and(not))
 *   - absorption (and(a, or(a, b)) ≡ a, or(a, and(a, b)) ≡ a)
 *   - idempotence (and(a, a) ≡ a, or(a, a) ≡ a)
 *
 * Distributive laws are NOT asserted — they hold mathematically but
 * we don't compute them (see CUT-LIST.md hard lock #5).
 */

const atomArb: fc.Arbitrary<ConditionAtom> = fc.record({
  kind: fc.constant('atom' as const),
  fact: fc.constantFrom('postLengthChars', 'accountAgeDays', 'authorKarma'),
  comparator: fc.oneof(
    fc.record({ kind: fc.constant('lt' as const), value: fc.integer({ min: 0, max: 1000 }) }),
    fc.record({ kind: fc.constant('gte' as const), value: fc.integer({ min: 0, max: 1000 }) }),
  ),
  atomId: fc.stringMatching(/^[A-Z0-9]{6,16}$/),
}) as fc.Arbitrary<ConditionAtom>;

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

describe('Boolean laws (property)', () => {
  it('De Morgan: not(and(a, b)) ≡ or(not(a), not(b))', () => {
    fc.assert(
      fc.property(treeArb, treeArb, bagArb, (a, b, bag) => {
        const lhs = evaluateTree(
          { kind: 'not', child: { kind: 'and', children: [a, b] } },
          bag,
        ).matched;
        const rhs = evaluateTree(
          {
            kind: 'or',
            children: [
              { kind: 'not', child: a },
              { kind: 'not', child: b },
            ],
          },
          bag,
        ).matched;
        return lhs === rhs;
      }),
    );
  });

  it('De Morgan: not(or(a, b)) ≡ and(not(a), not(b))', () => {
    fc.assert(
      fc.property(treeArb, treeArb, bagArb, (a, b, bag) => {
        const lhs = evaluateTree(
          { kind: 'not', child: { kind: 'or', children: [a, b] } },
          bag,
        ).matched;
        const rhs = evaluateTree(
          {
            kind: 'and',
            children: [
              { kind: 'not', child: a },
              { kind: 'not', child: b },
            ],
          },
          bag,
        ).matched;
        return lhs === rhs;
      }),
    );
  });

  it('Idempotence: and(a, a) ≡ a', () => {
    fc.assert(
      fc.property(treeArb, bagArb, (a, bag) => {
        const lhs = evaluateTree({ kind: 'and', children: [a, a] }, bag).matched;
        const rhs = evaluateTree(a, bag).matched;
        return lhs === rhs;
      }),
    );
  });

  it('Idempotence: or(a, a) ≡ a', () => {
    fc.assert(
      fc.property(treeArb, bagArb, (a, bag) => {
        const lhs = evaluateTree({ kind: 'or', children: [a, a] }, bag).matched;
        const rhs = evaluateTree(a, bag).matched;
        return lhs === rhs;
      }),
    );
  });

  it('Absorption: and(a, or(a, b)) ≡ a', () => {
    fc.assert(
      fc.property(treeArb, treeArb, bagArb, (a, b, bag) => {
        const lhs = evaluateTree(
          { kind: 'and', children: [a, { kind: 'or', children: [a, b] }] },
          bag,
        ).matched;
        const rhs = evaluateTree(a, bag).matched;
        return lhs === rhs;
      }),
    );
  });

  it('Absorption: or(a, and(a, b)) ≡ a', () => {
    fc.assert(
      fc.property(treeArb, treeArb, bagArb, (a, b, bag) => {
        const lhs = evaluateTree(
          { kind: 'or', children: [a, { kind: 'and', children: [a, b] }] },
          bag,
        ).matched;
        const rhs = evaluateTree(a, bag).matched;
        return lhs === rhs;
      }),
    );
  });
});

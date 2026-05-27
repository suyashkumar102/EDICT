import { describe, expect, it } from 'vitest';
import { compiledRuleSchema } from '@compilation/schema/RuleSchema';

/**
 * Schema-level regex safety. The Zod schema for the `matches` comparator
 * runs `validatePattern` from SafeRegex.ts as a refinement, so a bad
 * pattern is refused before the rule ever reaches the event store.
 *
 * These tests pin that contract — they are the compile-time half of the
 * defence; SafeRegex.test.ts is the run-time half.
 */

const ruleWithPattern = (pattern: string): unknown => ({
  schemaVersion: 1,
  title: 'pattern-test',
  description: 'description ten chars or more please.',
  englishSource: 'lock matching titles',
  compilerConfidence: 0.9,
  clauses: [
    {
      clauseName: 'pattern-clause',
      when: {
        kind: 'atom',
        fact: 'titleMatchesPattern',
        comparator: { kind: 'matches', pattern, caseSensitive: false },
        atomId: 'PATATOM01',
      },
      verdict: { kind: 'lock' },
    },
  ],
});

describe('compiledRuleSchema regex refinement', () => {
  it('accepts a safe literal pattern', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern('spam-site\\.example'));
    expect(r.success).toBe(true);
  });

  it('accepts a safe character class', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern('^buy[a-z]+'));
    expect(r.success).toBe(true);
  });

  it('rejects nested-quantifier ReDoS shape (a+)+', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern('(a+)+'));
    expect(r.success).toBe(false);
  });

  it('rejects nested-quantifier (a*)*', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern('(a*)*'));
    expect(r.success).toBe(false);
  });

  it('rejects backreferences \\1', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern('(\\w)\\1'));
    expect(r.success).toBe(false);
  });

  it('rejects an invalid regex source', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern('(unbalanced'));
    expect(r.success).toBe(false);
  });

  it('rejects a pattern over MAX_PATTERN_CHARS', () => {
    const tooLong = 'a'.repeat(201);
    const r = compiledRuleSchema.safeParse(ruleWithPattern(tooLong));
    expect(r.success).toBe(false);
  });

  it('rejects an empty pattern (min(1) at schema level)', () => {
    const r = compiledRuleSchema.safeParse(ruleWithPattern(''));
    expect(r.success).toBe(false);
  });
});

describe('compiledRuleSchema bounds', () => {
  it('rejects title < 3 chars', () => {
    const r = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'ab',
      description: 'description ten chars or more please.',
      englishSource: 'lock all caps',
      compilerConfidence: 0.9,
      clauses: [
        {
          clauseName: 'caps',
          when: {
            kind: 'atom',
            fact: 'titleAllCaps',
            comparator: { kind: 'isTrue' },
            atomId: 'CAPSATOM01',
          },
          verdict: { kind: 'lock' },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    const r = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'lock caps',
      description: 'description ten chars or more please.',
      englishSource: 'lock all caps',
      compilerConfidence: 1.2,
      clauses: [
        {
          clauseName: 'caps',
          when: {
            kind: 'atom',
            fact: 'titleAllCaps',
            comparator: { kind: 'isTrue' },
            atomId: 'CAPSATOM01',
          },
          verdict: { kind: 'lock' },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects more than 10 children in AND', () => {
    const children = Array.from({ length: 11 }, (_, i) => ({
      kind: 'atom',
      fact: 'titleAllCaps',
      comparator: { kind: 'isTrue' },
      atomId: `ATOM00${i}AAA`,
    }));
    const r = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'wide AND',
      description: 'description ten chars or more please.',
      englishSource: 'wide and tree',
      compilerConfidence: 0.9,
      clauses: [
        {
          clauseName: 'wide',
          when: { kind: 'and', children },
          verdict: { kind: 'lock' },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects more than 8 clauses', () => {
    const clauses = Array.from({ length: 9 }, (_, i) => ({
      clauseName: `clause-${i}`,
      when: {
        kind: 'atom',
        fact: 'titleAllCaps',
        comparator: { kind: 'isTrue' },
        atomId: `ATOM${i}00AAA`,
      },
      verdict: { kind: 'lock' },
    }));
    const r = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'too-many-clauses',
      description: 'description ten chars or more please.',
      englishSource: 'many clauses',
      compilerConfidence: 0.9,
      clauses,
    });
    expect(r.success).toBe(false);
  });

  it('rejects atomId not matching /^[A-Z0-9]{6,16}$/', () => {
    const r = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'bad atom id',
      description: 'description ten chars or more please.',
      englishSource: 'bad atom id',
      compilerConfidence: 0.9,
      clauses: [
        {
          clauseName: 'x',
          when: {
            kind: 'atom',
            fact: 'titleAllCaps',
            comparator: { kind: 'isTrue' },
            atomId: 'lowercase',
          },
          verdict: { kind: 'lock' },
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

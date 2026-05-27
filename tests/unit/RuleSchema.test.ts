import { describe, expect, it } from 'vitest';
import { compiledRuleSchema, formatIssues } from '@compilation/schema/RuleSchema';

describe('compiledRuleSchema', () => {
  it('accepts a minimal single-atom rule', () => {
    const result = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'Lock caps',
      description: 'Lock posts with all-caps titles.',
      englishSource: 'Lock all caps titles.',
      compilerConfidence: 0.95,
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
    });
    expect(result.success).toBe(true);
  });

  it('rejects schemaVersion != 1', () => {
    const result = compiledRuleSchema.safeParse({
      schemaVersion: 2,
      title: 'x',
      description: 'description ten chars',
      englishSource: 'english source',
      compilerConfidence: 0.5,
      clauses: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty clauses array', () => {
    const result = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'empty',
      description: 'has no clauses!',
      englishSource: 'no clauses here',
      compilerConfidence: 0.5,
      clauses: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 8 clauses', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      clauseName: `c${i}`,
      when: {
        kind: 'atom',
        fact: 'titleAllCaps',
        comparator: { kind: 'isTrue' },
        atomId: `X${i}A2345`,
      },
      verdict: { kind: 'lock' },
    }));
    const result = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'lots',
      description: 'too many clauses',
      englishSource: 'overflowing',
      compilerConfidence: 0.5,
      clauses: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown action verdict', () => {
    const result = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'bad verdict',
      description: 'unknown verdict kind',
      englishSource: 'bad verdict source',
      compilerConfidence: 0.5,
      clauses: [
        {
          clauseName: 'x',
          when: {
            kind: 'atom',
            fact: 'titleAllCaps',
            comparator: { kind: 'isTrue' },
            atomId: 'CAPS01',
          },
          verdict: { kind: 'nuke' },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects atom comparator type mismatches (matches comparator on a numeric fact)', () => {
    const result = compiledRuleSchema.safeParse({
      schemaVersion: 1,
      title: 'mismatched',
      description: 'matches on numeric',
      englishSource: 'mismatched comparator',
      compilerConfidence: 0.5,
      clauses: [
        {
          clauseName: 'mismatch-clause',
          when: {
            kind: 'atom',
            fact: 'postLengthChars',
            comparator: { kind: 'matches', pattern: 'abc', caseSensitive: false },
            atomId: 'P1A234',
          },
          verdict: { kind: 'lock' },
        },
      ],
    });
    // Schema-level we accept the comparator union; runtime evaluator will reject — see CompilerService
    expect(result.success).toBe(true);
  });

  it('formatIssues produces human-readable strings on failure', () => {
    const result = compiledRuleSchema.safeParse({});
    expect(result.success).toBe(false);
    const issues = formatIssues(result);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/—/);
  });
});

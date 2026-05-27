import { describe, expect, it } from 'vitest';
import {
  MAX_HAYSTACK_CHARS,
  MAX_PATTERN_CHARS,
  safeRegexTest,
  validatePattern,
} from '@evaluation/conditions/SafeRegex';

/**
 * SafeRegex is the second of two regex-safety gates (the first is in
 * RuleSchema.ts at compile time). These tests pin the exact ReDoS shapes
 * we refuse, and the input-truncation behaviour that keeps a pathological
 * haystack from blocking the Devvit handler.
 */
describe('validatePattern', () => {
  it('accepts a plain string match', () => {
    expect(validatePattern('hello')).toEqual({ ok: true });
  });

  it('accepts a non-quantified character class', () => {
    expect(validatePattern('[a-z]')).toEqual({ ok: true });
  });

  it('accepts a single-level quantifier', () => {
    expect(validatePattern('a+')).toEqual({ ok: true });
    expect(validatePattern('a*')).toEqual({ ok: true });
    expect(validatePattern('a{1,3}')).toEqual({ ok: true });
  });

  it('rejects nested quantifier (a+)+', () => {
    expect(validatePattern('(a+)+').ok).toBe(false);
    expect(validatePattern('(a+)+').reason).toBe('nested-quantifier');
  });

  it('rejects nested quantifier (a*)*', () => {
    expect(validatePattern('(a*)*').ok).toBe(false);
  });

  it('rejects nested quantifier (a+)*', () => {
    expect(validatePattern('(a+)*').ok).toBe(false);
  });

  it('rejects nested quantifier (a{1,3})+', () => {
    expect(validatePattern('(a{1,3})+').ok).toBe(false);
  });

  it('rejects backreferences \\1', () => {
    expect(validatePattern('(\\w)\\1').ok).toBe(false);
    expect(validatePattern('(\\w)\\1').reason).toBe('backreference');
  });

  it('rejects backreference \\9', () => {
    expect(validatePattern('(a)(b)(c)(d)(e)(f)(g)(h)(i)\\9').ok).toBe(false);
  });

  it('accepts an escaped backslash followed by a digit (no backref)', () => {
    expect(validatePattern('\\\\1').ok).toBe(true);
  });

  it('rejects a pattern longer than MAX_PATTERN_CHARS', () => {
    const big = 'a'.repeat(MAX_PATTERN_CHARS + 1);
    expect(validatePattern(big).ok).toBe(false);
    expect(validatePattern(big).reason).toBe('too-long');
  });

  it('accepts a pattern exactly at MAX_PATTERN_CHARS', () => {
    const exact = 'a'.repeat(MAX_PATTERN_CHARS);
    expect(validatePattern(exact).ok).toBe(true);
  });

  it("rejects an invalid pattern that the regex engine can't parse", () => {
    expect(validatePattern('(unclosed').ok).toBe(false);
    expect(validatePattern('(unclosed').reason).toBe('invalid');
  });
});

describe('safeRegexTest', () => {
  it('matches a plain substring case-insensitively when requested', () => {
    expect(safeRegexTest('hello', 'HELLO world', { caseSensitive: false })).toBe(true);
    expect(safeRegexTest('hello', 'HELLO world', { caseSensitive: true })).toBe(false);
  });

  it('returns false for an unsafe pattern (does not throw)', () => {
    expect(safeRegexTest('(a+)+$', 'aaaaaaaaaaab', { caseSensitive: false })).toBe(false);
    expect(safeRegexTest('(\\w)\\1', 'abc', { caseSensitive: false })).toBe(false);
  });

  it('truncates the haystack to MAX_HAYSTACK_CHARS before matching', () => {
    // The pattern is "needle" which only appears AFTER the truncation
    // boundary. The safe runner should not find it.
    const haystack = 'a'.repeat(MAX_HAYSTACK_CHARS) + 'needle';
    expect(safeRegexTest('needle', haystack, { caseSensitive: false })).toBe(false);
  });

  it('returns true when the needle is inside the truncated window', () => {
    const haystack = 'a'.repeat(MAX_HAYSTACK_CHARS - 6) + 'needle' + 'a'.repeat(1000);
    expect(safeRegexTest('needle', haystack, { caseSensitive: false })).toBe(true);
  });

  it('returns false on an empty pattern (zod-rejected upstream, defensive here)', () => {
    expect(safeRegexTest('', 'anything', { caseSensitive: false })).toBe(false);
  });
});

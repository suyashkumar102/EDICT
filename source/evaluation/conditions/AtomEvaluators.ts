import type { Comparator, ConditionAtom, ConditionAtomKind } from '@domain/values/RuleClause';
import type { FactBag, FactValue } from '@evaluation/factbag/FactBag';
import { readFact } from '@evaluation/factbag/FactBag';
import { safeRegexTest } from '@evaluation/conditions/SafeRegex';

/**
 * Strategy pattern: one evaluator function per ConditionAtomKind. The
 * evaluator is responsible for:
 *   - resolving the fact slot
 *   - dispatching to the right Comparator
 *   - emitting a stable, human-readable trace fragment
 *
 * Adding a new fact: implement the evaluator, register it in
 * `ATOM_EVALUATORS`, add the kind to `conditionAtomKind` in RuleSchema,
 * and document it in CompilerSystemPrompt's atom list.
 *
 * Each evaluator returns an `AtomVerdict` rather than a boolean so the
 * trace can distinguish "didn't match" from "couldn't measure".
 */

export interface AtomVerdict {
  readonly matched: boolean;
  readonly measurable: boolean;
  readonly trace: string;
}

const fmt = (v: FactValue): string => {
  if (Array.isArray(v)) return `[${v.join(',')}]`;
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 37)}...` : v;
  return String(v);
};

/**
 * Type-narrowed comparator → numeric.
 */
const compareNumeric = (actual: number, c: Comparator): boolean => {
  switch (c.kind) {
    case 'lt':
      return actual < c.value;
    case 'lte':
      return actual <= c.value;
    case 'gt':
      return actual > c.value;
    case 'gte':
      return actual >= c.value;
    case 'between':
      return actual >= c.min && actual <= c.max;
    case 'eq':
      return typeof c.value === 'number' && actual === c.value;
    case 'neq':
      return typeof c.value === 'number' && actual !== c.value;
    case 'in':
      return c.values.some((v) => v === actual);
    default:
      return false;
  }
};

const compareEquality = (actual: FactValue, c: Comparator): boolean => {
  switch (c.kind) {
    case 'eq':
      return actual === c.value;
    case 'neq':
      return actual !== c.value;
    case 'in':
      if (Array.isArray(actual)) {
        return actual.some((a) => c.values.includes(a));
      }
      return c.values.some((v) => v === actual);
    default:
      return false;
  }
};

const compareString = (actual: string, c: Comparator): boolean => {
  switch (c.kind) {
    case 'matches':
      // Defence-in-depth: validates the pattern (length, nested
      // quantifier, backreference), truncates the haystack at 4 KB, and
      // returns false on any failure. The compile-time validator in
      // RuleSchema.ts rejects bad patterns *before* persistence, so this
      // runtime path is the second of two checks.
      return safeRegexTest(c.pattern, actual, { caseSensitive: c.caseSensitive });
    case 'eq':
      return actual === c.value;
    case 'neq':
      return actual !== c.value;
    case 'in':
      return c.values.some((v) => v === actual);
    default:
      return false;
  }
};

const compareBoolean = (actual: boolean, c: Comparator): boolean => {
  switch (c.kind) {
    case 'isTrue':
      return actual === true;
    case 'isFalse':
      return actual === false;
    case 'eq':
      return typeof c.value === 'boolean' && actual === c.value;
    case 'neq':
      return typeof c.value === 'boolean' && actual !== c.value;
    default:
      return false;
  }
};

type Evaluator = (atom: ConditionAtom, bag: FactBag) => AtomVerdict;

const numericFactEvaluator =
  (factName: ConditionAtomKind): Evaluator =>
  (atom, bag) => {
    const actual = readFact(bag, factName);
    if (actual === undefined) {
      return { matched: false, measurable: false, trace: `${factName}: n/a` };
    }
    if (typeof actual !== 'number') {
      return { matched: false, measurable: false, trace: `${factName}: bad type` };
    }
    const matched = compareNumeric(actual, atom.comparator);
    return {
      matched,
      measurable: true,
      trace: `${factName}=${fmt(actual)} cmp=${atom.comparator.kind}`,
    };
  };

const booleanFactEvaluator =
  (factName: ConditionAtomKind): Evaluator =>
  (atom, bag) => {
    const actual = readFact(bag, factName);
    if (actual === undefined) {
      return { matched: false, measurable: false, trace: `${factName}: n/a` };
    }
    if (typeof actual !== 'boolean') {
      return { matched: false, measurable: false, trace: `${factName}: bad type` };
    }
    const matched = compareBoolean(actual, atom.comparator);
    return {
      matched,
      measurable: true,
      trace: `${factName}=${fmt(actual)} cmp=${atom.comparator.kind}`,
    };
  };

const stringFactEvaluator =
  (factName: ConditionAtomKind): Evaluator =>
  (atom, bag) => {
    const actual = readFact(bag, factName);
    if (actual === undefined) {
      return { matched: false, measurable: false, trace: `${factName}: n/a` };
    }
    if (typeof actual !== 'string') {
      return { matched: false, measurable: false, trace: `${factName}: bad type` };
    }
    const matched = compareString(actual, atom.comparator);
    return {
      matched,
      measurable: true,
      trace: `${factName}=${fmt(actual)} cmp=${atom.comparator.kind}`,
    };
  };

const arrayInFactEvaluator =
  (factName: ConditionAtomKind): Evaluator =>
  (atom, bag) => {
    const actual = readFact(bag, factName);
    if (actual === undefined) {
      return { matched: false, measurable: false, trace: `${factName}: n/a` };
    }
    const matched = compareEquality(actual, atom.comparator);
    return {
      matched,
      measurable: true,
      trace: `${factName}=${fmt(actual)} cmp=${atom.comparator.kind}`,
    };
  };

export const ATOM_EVALUATORS: Readonly<Record<ConditionAtomKind, Evaluator>> = {
  postLengthChars: numericFactEvaluator('postLengthChars'),
  commentLengthChars: numericFactEvaluator('commentLengthChars'),
  accountAgeDays: numericFactEvaluator('accountAgeDays'),
  authorKarma: numericFactEvaluator('authorKarma'),
  authorVerifiedEmail: booleanFactEvaluator('authorVerifiedEmail'),
  titleMatchesPattern: stringFactEvaluator('titleMatchesPattern'),
  bodyMatchesPattern: stringFactEvaluator('bodyMatchesPattern'),
  titleAllCaps: booleanFactEvaluator('titleAllCaps'),
  titleQuestionMark: booleanFactEvaluator('titleQuestionMark'),
  hasLink: booleanFactEvaluator('hasLink'),
  domainEqualsAnyOf: arrayInFactEvaluator('domainEqualsAnyOf'),
  subredditAgeMinutes: numericFactEvaluator('subredditAgeMinutes'),
  reportCount: numericFactEvaluator('reportCount'),
  uniqueReporterCount: numericFactEvaluator('uniqueReporterCount'),
  flairEqualsAnyOf: stringFactEvaluator('flairEqualsAnyOf'),
  isSelfPost: booleanFactEvaluator('isSelfPost'),
  isCrosspost: booleanFactEvaluator('isCrosspost'),
  postScoreAfterMinutes: numericFactEvaluator('postScoreAfterMinutes'),
  replyCountAfterMinutes: numericFactEvaluator('replyCountAfterMinutes'),
  authorBannedInOtherSubInLastDays: numericFactEvaluator('authorBannedInOtherSubInLastDays'),
  authorHasModMail: booleanFactEvaluator('authorHasModMail'),
  timeOfDayHourUtc: numericFactEvaluator('timeOfDayHourUtc'),
};

export const evaluateAtom = (atom: ConditionAtom, bag: FactBag): AtomVerdict => {
  const evaluator = ATOM_EVALUATORS[atom.fact];
  return evaluator(atom, bag);
};

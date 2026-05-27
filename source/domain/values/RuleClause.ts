import type { ActionVerdict } from '@domain/values/ActionVerdict';

/**
 * RuleClause is the leaf of the compiled rule tree. A clause is `WHEN <condition tree>
 * THEN <action> [UNLESS <condition tree>]`. The condition trees are built from
 * combinator nodes (AND/OR/NOT) and atomic condition nodes (PostLength,
 * AccountAgeDays, …).
 *
 * A whole rule is `Rule = { clauses: NonEmptyArray<RuleClause> }`. Clauses run
 * in declared order; once any clause's WHEN matches and UNLESS doesn't, the
 * verdict is taken and evaluation short-circuits for that rule. This makes
 * authoring multi-clause rules predictable: order them most-specific to
 * least-specific, top to bottom.
 *
 * Combinator algebra and ConditionAtom kinds live in evaluation/combinators
 * and evaluation/conditions respectively — domain only knows the shape.
 */

export type ConditionAtomKind =
  | 'postLengthChars'
  | 'commentLengthChars'
  | 'accountAgeDays'
  | 'authorKarma'
  | 'authorVerifiedEmail'
  | 'titleMatchesPattern'
  | 'bodyMatchesPattern'
  | 'titleAllCaps'
  | 'titleQuestionMark'
  | 'hasLink'
  | 'domainEqualsAnyOf'
  | 'subredditAgeMinutes'
  | 'reportCount'
  | 'uniqueReporterCount'
  | 'flairEqualsAnyOf'
  | 'isSelfPost'
  | 'isCrosspost'
  | 'postScoreAfterMinutes'
  | 'replyCountAfterMinutes'
  | 'authorBannedInOtherSubInLastDays'
  | 'authorHasModMail'
  | 'timeOfDayHourUtc';

export type Comparator =
  | { kind: 'lt'; value: number }
  | { kind: 'lte'; value: number }
  | { kind: 'eq'; value: number | string | boolean }
  | { kind: 'neq'; value: number | string | boolean }
  | { kind: 'gt'; value: number }
  | { kind: 'gte'; value: number }
  | { kind: 'between'; min: number; max: number }
  | { kind: 'matches'; pattern: string; caseSensitive: boolean }
  | { kind: 'in'; values: readonly (string | number)[] }
  | { kind: 'isTrue' }
  | { kind: 'isFalse' };

export interface ConditionAtom {
  readonly kind: 'atom';
  readonly fact: ConditionAtomKind;
  readonly comparator: Comparator;
  /** Stable id within the rule so explainability traces can reference each atom. */
  readonly atomId: string;
}

export type ConditionTree =
  | ConditionAtom
  | { readonly kind: 'and'; readonly children: readonly ConditionTree[] }
  | { readonly kind: 'or'; readonly children: readonly ConditionTree[] }
  | { readonly kind: 'not'; readonly child: ConditionTree };

export interface RuleClause {
  /** Stable, human-meaningful name set by the compiler ("short post + new account"). */
  readonly clauseName: string;
  /** Author's free-form note for future readers. Optional. */
  readonly comment?: string;
  /** WHEN: all listed condition trees must evaluate to true. */
  readonly when: ConditionTree;
  /** UNLESS: if present and matches, the WHEN is cancelled. */
  readonly unless?: ConditionTree;
  /** THEN: the verdict taken when WHEN matches and UNLESS doesn't. */
  readonly verdict: ActionVerdict;
}

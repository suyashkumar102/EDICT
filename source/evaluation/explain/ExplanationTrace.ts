import type { ClauseTrace } from '@evaluation/combinators/CombinatorAlgebra';
import type { FactBag } from '@evaluation/factbag/FactBag';
import { flatten } from '@evaluation/factbag/FactBag';

/**
 * The persisted, mod-facing explanation for why a rule fired (or didn't).
 *
 * Two views are derived from one ClauseTrace:
 *   - shortLine:  one-sentence summary for the Audit Timeline tile
 *   - fullTrace:  multi-line, indented tree for the "Explain this decision" modal
 *
 * The audit entry stored on disk uses `fullTrace` so a moderator hitting
 * "Explain" 28 days after the action can reconstruct exactly which atoms
 * matched, with the captured fact-bag values, without re-fetching the
 * post from Reddit.
 */

export interface DecisionExplanation {
  readonly matched: boolean;
  readonly shortLine: string;
  readonly fullTrace: readonly string[];
  readonly factSnapshot: Readonly<Record<string, string | number | boolean>>;
}

export const buildExplanation = (
  clauseName: string,
  whenTrace: ClauseTrace,
  unlessTrace: ClauseTrace | null,
  bag: FactBag,
): DecisionExplanation => {
  const fullTrace = [
    `clause: ${clauseName}`,
    `  WHEN:`,
    ...whenTrace.lines.map((l) => `    ${l}`),
    ...(unlessTrace ? [`  UNLESS:`, ...unlessTrace.lines.map((l) => `    ${l}`)] : []),
    `  result: ${whenTrace.matched && !(unlessTrace?.matched ?? false) ? 'FIRED' : 'no-fire'}`,
  ];
  const matched = whenTrace.matched && !(unlessTrace?.matched ?? false);
  const shortLine = matched
    ? `Fired "${clauseName}" (${whenTrace.lines.length} atom check(s) matched${unlessTrace ? ', UNLESS unmet' : ''})`
    : whenTrace.matched
      ? `Suppressed "${clauseName}" because UNLESS clause matched`
      : `Did not fire "${clauseName}" (WHEN unmet)`;

  return {
    matched,
    shortLine,
    fullTrace,
    factSnapshot: flatten(bag),
  };
};

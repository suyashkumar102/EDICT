import type { ActionVerdict } from '@domain/values/ActionVerdict';
import type { RuleClause } from '@domain/values/RuleClause';
import type { FactBag } from '@evaluation/factbag/FactBag';
import { evaluateTree } from '@evaluation/combinators/CombinatorAlgebra';
import type { DecisionExplanation } from '@evaluation/explain/ExplanationTrace';
import { buildExplanation } from '@evaluation/explain/ExplanationTrace';
import type { CompiledRule } from '@compilation/schema/RuleSchema';
import type { RuleId } from '@shared/types/BrandedPrimitives';

/**
 * RuleEvaluator is the pure-TS heart of EDICT. It takes:
 *   - the compiled rule
 *   - a FactBag (pre-built upstream)
 *   - the rule identity for traceability
 *
 * and returns either a Verdict (with full explanation) or null (no clause
 * fired). No network calls. No global state. No randomness. Same inputs
 * always produce the same output — this is what makes shadow-replay and
 * what-if-simulation trustworthy.
 *
 * Evaluation order is the order clauses were emitted by the compiler. First
 * clause to fire wins; subsequent clauses are skipped. The compiler
 * orders most-specific first (see CompilerSystemPrompt's CLAUSE ORDER
 * note), so this matches the moderator's mental model: "the more specific
 * description wins."
 */

export interface RuleVerdict {
  readonly ruleId: RuleId;
  readonly matchedClauseName: string;
  readonly verdict: ActionVerdict;
  readonly explanation: DecisionExplanation;
  /** The order index of the clause within the rule (0-based) — useful for analytics. */
  readonly clauseIndex: number;
}

export const evaluateRule = (
  ruleId: RuleId,
  rule: CompiledRule,
  bag: FactBag,
): RuleVerdict | null => {
  for (let i = 0; i < rule.clauses.length; i += 1) {
    const clause = rule.clauses[i] as RuleClause;
    const whenTrace = evaluateTree(clause.when, bag);
    if (!whenTrace.matched) continue;
    const unlessTrace = clause.unless ? evaluateTree(clause.unless, bag) : null;
    if (unlessTrace?.matched === true) continue;
    return {
      ruleId,
      matchedClauseName: clause.clauseName,
      verdict: clause.verdict,
      explanation: buildExplanation(clause.clauseName, whenTrace, unlessTrace, bag),
      clauseIndex: i,
    };
  }
  return null;
};

/**
 * Evaluate a *set* of rules in priority order. The first rule to produce
 * a verdict wins. Priority within a set is determined by:
 *   1. effectiveness score descending (most effective first)
 *   2. shadowStatus.phase: 'live' before 'shadowed'
 *   3. createdAt ascending (older rules first as a tiebreaker)
 *
 * The orchestration layer passes pre-sorted rules; we evaluate in array order.
 */
export interface EvaluatedRule {
  readonly ruleId: RuleId;
  readonly rule: CompiledRule;
  readonly shadowed: boolean;
}

export interface RuleSetEvaluation {
  readonly verdict: RuleVerdict | null;
  readonly shadowOnly: boolean;
  /** Every rule that *would have* matched, for conflict analytics. */
  readonly secondaryMatches: readonly RuleVerdict[];
}

export const evaluateRuleSet = (
  rules: readonly EvaluatedRule[],
  bag: FactBag,
): RuleSetEvaluation => {
  let primary: RuleVerdict | null = null;
  let primaryShadow = false;
  const secondaries: RuleVerdict[] = [];

  for (const r of rules) {
    const v = evaluateRule(r.ruleId, r.rule, bag);
    if (!v) continue;
    if (!primary) {
      primary = v;
      primaryShadow = r.shadowed;
    } else {
      secondaries.push(v);
    }
  }
  return {
    verdict: primary,
    shadowOnly: primaryShadow,
    secondaryMatches: secondaries,
  };
};

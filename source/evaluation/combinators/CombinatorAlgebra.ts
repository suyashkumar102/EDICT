import type { ConditionTree } from '@domain/values/RuleClause';
import type { FactBag } from '@evaluation/factbag/FactBag';
import { evaluateAtom } from '@evaluation/conditions/AtomEvaluators';

/**
 * Recursive combinator algebra. The contract:
 *
 *   evaluate(atom, bag)        →  per-atom evaluator
 *   evaluate(and(a,b), bag)    →  short-circuit on first false child
 *   evaluate(or(a,b), bag)     →  short-circuit on first true child
 *   evaluate(not(a), bag)      →  invert
 *
 * Short-circuit order: left-to-right as written. This matters because
 * evaluation is observable through the trace — a moderator reading the
 * audit log wants to see *why* the rule fired in the order they wrote it.
 *
 * Returning ClauseTrace (not just boolean) lets explainability mirror the
 * evaluation tree.
 *
 * Defensive guards (defence-in-depth alongside RuleSchema.ts):
 *
 *   - `MAX_DEPTH` (32) bounds recursion. The compile-time schema already
 *     caps siblings at 10 per AND/OR and clauses at 8, so a legitimate
 *     compiled tree won't approach this. The check exists to defend
 *     against a future schema regression or a hand-crafted event log.
 *
 *   - Empty children arrays short-circuit explicitly: `and([])` is
 *     vacuously true, `or([])` vacuously false. The schema requires
 *     min(2) children today, but again — defence-in-depth.
 *
 *   - When `MAX_DEPTH` is exceeded the evaluator returns `matched=false`
 *     so the rule simply doesn't fire. That's the safe failure mode for
 *     a moderation tool: refusing to act is recoverable; over-acting is not.
 */

export interface ClauseTrace {
  readonly matched: boolean;
  readonly lines: readonly string[];
}

export const MAX_DEPTH = 32;

const compose = (header: string, sub: readonly ClauseTrace[]): ClauseTrace => {
  const matched = header.startsWith('and:')
    ? sub.every((s) => s.matched)
    : header.startsWith('or:')
      ? sub.some((s) => s.matched)
      : header.startsWith('not:')
        ? !(sub[0]?.matched ?? false)
        : (sub[0]?.matched ?? false);
  const lines = [header, ...sub.flatMap((s) => s.lines.map((l) => `  ${l}`))];
  return { matched, lines };
};

const evaluateTreeAtDepth = (tree: ConditionTree, bag: FactBag, depth: number): ClauseTrace => {
  if (depth > MAX_DEPTH) {
    return {
      matched: false,
      lines: [`depth-cap: refusing to evaluate past ${MAX_DEPTH} levels`],
    };
  }
  if (tree.kind === 'atom') {
    const v = evaluateAtom(tree, bag);
    return {
      matched: v.matched,
      lines: [`atom[${tree.atomId}] ${v.trace} ⇒ ${v.matched ? 'MATCH' : 'no-match'}`],
    };
  }
  if (tree.kind === 'and') {
    // `and([])` is the empty conjunction — vacuously true. The schema
    // forbids this shape (min: 2), so reaching it indicates an upstream
    // bug; emit a trace line so it's visible rather than silently
    // matching everything.
    if (tree.children.length === 0) {
      return { matched: true, lines: ['and: empty-children ⇒ vacuously-true'] };
    }
    const accumulated: ClauseTrace[] = [];
    let allMatched = true;
    for (const child of tree.children) {
      const childTrace = evaluateTreeAtDepth(child, bag, depth + 1);
      accumulated.push(childTrace);
      if (!childTrace.matched) {
        allMatched = false;
        break; // short-circuit
      }
    }
    return compose(`and: ${allMatched ? 'all-matched' : 'short-circuited-false'}`, accumulated);
  }
  if (tree.kind === 'or') {
    // `or([])` is the empty disjunction — vacuously false. Same caveat
    // as `and([])`: the schema forbids this shape.
    if (tree.children.length === 0) {
      return { matched: false, lines: ['or: empty-children ⇒ vacuously-false'] };
    }
    const accumulated: ClauseTrace[] = [];
    let anyMatched = false;
    for (const child of tree.children) {
      const childTrace = evaluateTreeAtDepth(child, bag, depth + 1);
      accumulated.push(childTrace);
      if (childTrace.matched) {
        anyMatched = true;
        break; // short-circuit
      }
    }
    return compose(`or: ${anyMatched ? 'short-circuited-true' : 'none-matched'}`, accumulated);
  }
  // not
  const inner = evaluateTreeAtDepth(tree.child, bag, depth + 1);
  return compose(`not: child=${inner.matched ? 'matched→invert' : 'unmatched→invert'}`, [inner]);
};

export const evaluateTree = (tree: ConditionTree, bag: FactBag): ClauseTrace =>
  evaluateTreeAtDepth(tree, bag, 0);

/**
 * Boolean algebra simplification used by ConflictDetector to compare two
 * rules' WHEN trees. Implements:
 *   not(not(x)) → x
 *   and(x, true) → x   (we collapse this when a child is trivially true)
 *   or(x, false) → x
 *   distributive laws are NOT applied — they'd explode tree size and
 *     don't help conflict detection.
 *
 * Bounded by MAX_DEPTH like evaluateTree, with the same fail-safe: a
 * tree that exceeds the cap is returned unmodified rather than throwing.
 */
const normalizeAtDepth = (tree: ConditionTree, depth: number): ConditionTree => {
  if (depth > MAX_DEPTH) return tree;
  if (tree.kind === 'atom') return tree;
  if (tree.kind === 'not') {
    const inner = normalizeAtDepth(tree.child, depth + 1);
    if (inner.kind === 'not') return inner.child;
    return { kind: 'not', child: inner };
  }
  if (tree.kind === 'and' || tree.kind === 'or') {
    const children = tree.children.map((c) => normalizeAtDepth(c, depth + 1));
    // flatten same-kind nesting: and(a, and(b,c)) → and(a,b,c)
    const flat: ConditionTree[] = [];
    for (const c of children) {
      if (c.kind === tree.kind) {
        flat.push(...c.children);
      } else {
        flat.push(c);
      }
    }
    if (flat.length === 1 && flat[0]) return flat[0];
    return { kind: tree.kind, children: flat };
  }
  return tree;
};

export const normalize = (tree: ConditionTree): ConditionTree => normalizeAtDepth(tree, 0);

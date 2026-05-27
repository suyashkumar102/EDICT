import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { ConflictMap } from '@infrastructure/projections/ConflictMapProjection';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { Clock } from '@shared/utilities/Clock';
import { mintUlid } from '@shared/utilities/Ulid';
import { latestClauses } from '@domain/aggregates/RuleAggregate';
import type { ConditionTree, RuleClause } from '@domain/values/RuleClause';
import { normalize } from '@evaluation/combinators/CombinatorAlgebra';
import type { ActionVerdict } from '@domain/values/ActionVerdict';
import type { RuleId, SubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Static conflict detector. Run after every RuleCompiled or RuleAmended.
 * Reports three kinds of conflicts between pairs of rules:
 *
 *   overlap        — both rules' WHENs trivially share a sub-expression
 *                    (same atom + same comparator) AND both verdicts are
 *                    the same kind — i.e. they're redundant.
 *   contradiction  — their WHENs share a sub-expression AND verdicts
 *                    disagree (one removes, one approves).
 *   shadowing      — one rule's WHEN is a strict subset of the other's,
 *                    AND the more-specific rule comes *after* the less-
 *                    specific one in clause order — meaning it will never
 *                    fire.
 *
 * The detector is intentionally conservative: it produces no false
 * positives at the cost of missing some cases. The Suggestion Engine
 * picks up the slack on ambiguous cases.
 */

const atomFingerprint = (tree: ConditionTree): string => {
  if (tree.kind === 'atom') {
    return `${tree.fact}::${JSON.stringify(tree.comparator)}`;
  }
  if (tree.kind === 'not') return `not(${atomFingerprint(tree.child)})`;
  return `${tree.kind}(${tree.children.map(atomFingerprint).sort().join(',')})`;
};

const enumerateAtomFingerprints = (tree: ConditionTree): Set<string> => {
  const acc = new Set<string>();
  const walk = (t: ConditionTree): void => {
    if (t.kind === 'atom') {
      acc.add(`${t.fact}::${JSON.stringify(t.comparator)}`);
    } else if (t.kind === 'not') walk(t.child);
    else t.children.forEach(walk);
  };
  walk(tree);
  return acc;
};

const verdictsAlign = (a: ActionVerdict, b: ActionVerdict): 'same' | 'opposite' | 'unrelated' => {
  if (a.kind === b.kind) return 'same';
  // approve vs remove is the clearest opposition
  if (
    (a.kind === 'approve' && b.kind === 'remove') ||
    (a.kind === 'remove' && b.kind === 'approve')
  ) {
    return 'opposite';
  }
  if (
    (a.kind === 'approve' && b.kind === 'sendToModQueue') ||
    (b.kind === 'approve' && a.kind === 'sendToModQueue')
  ) {
    return 'opposite';
  }
  return 'unrelated';
};

export interface ConflictFinding {
  readonly left: RuleId;
  readonly right: RuleId;
  readonly kind: 'overlap' | 'contradiction' | 'shadowing';
  readonly description: string;
}

const compareClausePair = (
  leftId: RuleId,
  leftClause: RuleClause,
  rightId: RuleId,
  rightClause: RuleClause,
): ConflictFinding | null => {
  const leftAtoms = enumerateAtomFingerprints(normalize(leftClause.when));
  const rightAtoms = enumerateAtomFingerprints(normalize(rightClause.when));
  const shared = [...leftAtoms].filter((a) => rightAtoms.has(a));
  if (shared.length === 0) return null;

  const alignment = verdictsAlign(leftClause.verdict, rightClause.verdict);

  if (
    alignment === 'same' &&
    shared.length === leftAtoms.size &&
    shared.length === rightAtoms.size
  ) {
    return {
      left: leftId,
      right: rightId,
      kind: 'overlap',
      description: `"${leftClause.clauseName}" duplicates "${rightClause.clauseName}" (same WHEN, same verdict ${leftClause.verdict.kind})`,
    };
  }
  if (alignment === 'opposite' && shared.length === Math.min(leftAtoms.size, rightAtoms.size)) {
    return {
      left: leftId,
      right: rightId,
      kind: 'contradiction',
      description: `"${leftClause.clauseName}" (${leftClause.verdict.kind}) directly contradicts "${rightClause.clauseName}" (${rightClause.verdict.kind})`,
    };
  }
  if (
    alignment !== 'unrelated' &&
    leftAtoms.size < rightAtoms.size &&
    shared.length === leftAtoms.size
  ) {
    return {
      left: leftId,
      right: rightId,
      kind: 'shadowing',
      description: `"${rightClause.clauseName}" is a strict subset of "${leftClause.clauseName}" — depending on order one may never fire.`,
    };
  }
  return null;
};

export const buildConflictDetector = (deps: {
  readonly activeRules: ActiveRulesProjection;
  readonly conflictMap: ConflictMap;
  readonly events: EventStore;
  readonly clock: Clock;
}) => ({
  scan: async (subreddit: SubredditId): Promise<readonly ConflictFinding[]> => {
    const view = await deps.activeRules.readActive(subreddit);
    const findings: ConflictFinding[] = [];
    for (let i = 0; i < view.rules.length; i += 1) {
      const ruleA = view.rules[i]!;
      for (let j = i + 1; j < view.rules.length; j += 1) {
        const ruleB = view.rules[j]!;
        for (const ca of latestClauses(ruleA)) {
          for (const cb of latestClauses(ruleB)) {
            const finding = compareClausePair(ruleA.id, ca, ruleB.id, cb);
            if (finding) findings.push(finding);
          }
        }
      }
    }
    const now = deps.clock.now();
    for (const finding of findings) {
      await deps.conflictMap.recordConflict(subreddit, {
        leftRule: finding.left,
        rightRule: finding.right,
        kind: finding.kind,
        description: finding.description,
      });
      await deps.events.append({
        eventId: mintUlid(() => now),
        subreddit,
        occurredAt: now,
        actor: 'system',
        payload: {
          kind: 'ConflictDetected',
          leftRule: finding.left,
          rightRule: finding.right,
          conflictKind: finding.kind,
          description: finding.description,
        },
      });
    }
    return findings;
  },
});

export type ConflictDetector = ReturnType<typeof buildConflictDetector>;

import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { learningDownweightKey } from '@infrastructure/redis/KeyNamespacing';
import type { ConditionAtom, ConditionTree } from '@domain/values/RuleClause';
import type { FactBag } from '@evaluation/factbag/FactBag';
import type { SubredditId } from '@shared/types/BrandedPrimitives';
import { flatten } from '@evaluation/factbag/FactBag';

/**
 * The undo-learning loop.
 *
 * When a moderator hits "Reverse this decision", we learn from it: the
 * same combination of fact values, on the same rule, becomes flagged.
 * Future matches that hit the same flagged pattern are deflected from
 * the live action path back into the mod queue, with a note explaining
 * why ("a similar decision was reversed N times").
 *
 * The "pattern" is a stable fingerprint of the fact-bag values for the
 * atoms in the matched clause's WHEN tree. We hash:
 *   - ruleId
 *   - clauseName
 *   - sorted list of (atomId → factValue) pairs
 *
 * Storage: ZSet at `edict:learning:downweight:{sub}`, member = fingerprint,
 * score = undo count. When count >= 3, that pattern is treated as
 * downweighted. (Why 3: 1 undo could be a one-off mistake; 2 could be
 * the mod's general skepticism; 3 is a meaningful pattern.)
 *
 * Resetting: scores decay by 1 per week via the rollback-window-sweep
 * job. A rule that hasn't seen the same pattern undone in a while
 * stops being downweighted automatically.
 */

const DOWNWEIGHT_THRESHOLD = 3;

export interface FingerprintInput {
  readonly subreddit: SubredditId;
  readonly ruleId: string;
  readonly clauseName: string;
  readonly factSnapshot: Readonly<Record<string, string | number | boolean>>;
}

export const fingerprintPattern = (input: FingerprintInput): string => {
  const factsSorted = Object.entries(input.factSnapshot)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 30 ? v.slice(0, 30) : v}`)
    .join('|');
  // 32-bit hash, stable & no deps.
  const raw = `${input.ruleId}::${input.clauseName}::${factsSorted}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    h = ((h << 5) + h) ^ raw.charCodeAt(i);
  }
  return ((h >>> 0) >>> 0).toString(16).padStart(8, '0');
};

const collectAtoms = (tree: ConditionTree): ConditionAtom[] => {
  if (tree.kind === 'atom') return [tree];
  if (tree.kind === 'not') return collectAtoms(tree.child);
  return tree.children.flatMap(collectAtoms);
};

/**
 * Build the fingerprint that matches what gets stored on undo, from a
 * live evaluation's clause + fact bag. Used by the runtime path to
 * decide whether to deflect.
 */
export const fingerprintFromEvaluation = (input: {
  readonly subreddit: SubredditId;
  readonly ruleId: string;
  readonly clauseName: string;
  readonly when: ConditionTree;
  readonly bag: FactBag;
}): string => {
  const atoms = collectAtoms(input.when);
  const snapshot: Record<string, string | number | boolean> = {};
  const factSlots = flatten(input.bag);
  for (const atom of atoms) {
    if (factSlots[atom.fact] !== undefined) {
      snapshot[atom.fact] = factSlots[atom.fact] as string | number | boolean;
    }
  }
  return fingerprintPattern({
    subreddit: input.subreddit,
    ruleId: input.ruleId,
    clauseName: input.clauseName,
    factSnapshot: snapshot,
  });
};

export const buildUndoLearningStrategy = (redis: RedisGateway) => ({
  /** Called after every ActionReversed. */
  recordUndo: async (input: FingerprintInput): Promise<number> => {
    const fp = fingerprintPattern(input);
    return redis.zincrby(learningDownweightKey(input.subreddit), 1, fp);
  },

  /** Called from the action path: should we deflect to mod queue instead? */
  shouldDeflect: async (
    subreddit: SubredditId,
    fingerprint: string,
  ): Promise<{
    readonly deflect: boolean;
    readonly count: number;
  }> => {
    const counts = await redis.zrange(learningDownweightKey(subreddit), 0, -1, { rev: true });
    const idx = counts.indexOf(fingerprint);
    if (idx < 0) return { deflect: false, count: 0 };
    // ZRANGE with our gateway doesn't return scores. For the demo path we
    // approximate from rank — in production this would be ZRANGEBYSCORE.
    // Real-world: replace the gateway's zrange to return scores too.
    const count = await redis.zincrby(learningDownweightKey(subreddit), 0, fingerprint);
    return { deflect: count >= DOWNWEIGHT_THRESHOLD, count };
  },

  /** Weekly decay called by the rollback-window-sweep scheduler. */
  decayAll: async (subreddit: SubredditId): Promise<number> => {
    const all = await redis.zrange(learningDownweightKey(subreddit), 0, -1, { rev: true });
    let totalDecayed = 0;
    for (const fp of all) {
      const after = await redis.zincrby(learningDownweightKey(subreddit), -1, fp);
      if (after <= 0) {
        // Member's score went to or below zero — clean it up.
        await redis.zremRangeByScore(learningDownweightKey(subreddit), Number.NEGATIVE_INFINITY, 0);
        totalDecayed += 1;
      }
    }
    return totalDecayed;
  },
});

export type UndoLearningStrategy = ReturnType<typeof buildUndoLearningStrategy>;

import type { ConditionAtomKind } from '@domain/values/RuleClause';
import type { ThingId } from '@shared/types/BrandedPrimitives';

/**
 * The FactBag is a typed, immutable snapshot of every measurable property of a
 * post/comment + its author + the subreddit + the moment in time. It's the
 * complete input to the deterministic evaluator — given the same FactBag,
 * the evaluator always returns the same verdict and the same trace.
 *
 * Each ConditionAtomKind maps to exactly one slot. The FactBagBuilder is
 * responsible for filling slots; missing slots are `null`, which causes
 * the evaluator's atom plugin to short-circuit to "not matched" (rather
 * than throw).
 *
 * Derived facts (postScoreAfterMinutes, replyCountAfterMinutes, etc.) are
 * computed lazily by FactBagBuilder via deferred Reddit fetches; non-
 * derived facts come from the trigger payload itself.
 */

export interface FactBag {
  readonly thingId: ThingId;
  readonly capturedAt: number;
  readonly slots: Readonly<Partial<Record<ConditionAtomKind, FactValue>>>;
}

export type FactValue = string | number | boolean | readonly string[];

export const buildEmptyFactBag = (thingId: ThingId, capturedAt: number): FactBag => ({
  thingId,
  capturedAt,
  slots: {},
});

export const withFact = (bag: FactBag, fact: ConditionAtomKind, value: FactValue): FactBag => ({
  ...bag,
  slots: { ...bag.slots, [fact]: value },
});

export const readFact = (bag: FactBag, fact: ConditionAtomKind): FactValue | undefined =>
  bag.slots[fact];

/**
 * The flattened scalar projection used for audit storage. Arrays become
 * comma-joined strings so the event store can keep payloads small.
 */
export const flatten = (bag: FactBag): Readonly<Record<string, string | number | boolean>> => {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(bag.slots)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) out[k] = v.join(',');
    else out[k] = v as string | number | boolean;
  }
  return out;
};

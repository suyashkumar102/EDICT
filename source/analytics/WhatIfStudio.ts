import type { CompiledRule } from '@compilation/schema/RuleSchema';
import type { FactBag } from '@evaluation/factbag/FactBag';
import { evaluateRule, type RuleVerdict } from '@evaluation/RuleEvaluator';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import {
  brandRuleId,
  type SubredditId,
  type ThingId,
  type TimestampMs,
} from '@shared/types/BrandedPrimitives';
import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import { factsReferencedBy } from '@evaluation/factbag/FactBagBuilder';
import { latestClauses } from '@domain/aggregates/RuleAggregate';
import { isEventKind } from '@domain/events/DomainEvent';

/**
 * The What-If Studio is EDICT's marquee analytics feature.
 *
 * The Studio replays a *draft* compiled rule against the last 30 days
 * of event-store data — i.e. against the full historical FactBag stream
 * that every post and comment generated. Unlike a preview that only
 * scans currently-visible posts, this works against persisted snapshots,
 * so removed/archived items still count.
 *
 * For each historical thing, it answers:
 *   1. Would this rule have fired?
 *   2. If yes, what would it have done?
 *   3. Did a mod actually approve / reject it manually at the time?
 *      (We can infer this from the audit history.)
 *
 * Result: a side-by-side report showing
 *   - how many posts the rule would catch
 *   - how many would *also* have been mod-approved (false positives)
 *   - how the rule compares to the most-similar existing live rule
 *
 * The studio runs entirely in-process (no LLM, no Reddit fetch). The
 * historical fact-bags are reconstructed from the ShadowDecisionRecorded
 * / ActionTaken events, which preserve the factBagSnapshot field
 * specifically to enable this.
 */

export interface WhatIfReport {
  readonly draftRuleId: string;
  readonly windowStart: TimestampMs;
  readonly windowEnd: TimestampMs;
  readonly thingsConsidered: number;
  readonly thingsThatWouldHaveFired: number;
  readonly thingsManuallyApprovedByMods: number;
  readonly thingsRemovedByOtherRules: number;
  readonly verdictBreakdown: Readonly<Record<string, number>>;
  readonly examples: readonly {
    readonly thingId: ThingId;
    readonly matchedClauseName: string;
    readonly verdict: string;
    readonly explanationShort: string;
  }[];
  readonly comparisonToActiveRules: readonly {
    readonly activeRuleId: string;
    readonly overlapCount: number;
    readonly overlapPercent: number;
  }[];
}

const reconstructFactBag = (
  snapshot: Record<string, string | number | boolean>,
  thingId: ThingId,
  capturedAt: number,
): FactBag => {
  const slots: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    slots[k] = v;
  }
  // The flattened snapshot uses comma-joined strings for arrays. We don't
  // reconstruct arrays here because the AtomEvaluators only need scalar
  // slots for replay; arrays are only needed for *building* fresh bags.
  return { thingId, capturedAt, slots: slots as FactBag['slots'] };
};

export const buildWhatIfStudio = (deps: {
  readonly events: EventStore;
  readonly activeRules: ActiveRulesProjection;
}) => ({
  replay: async (input: {
    readonly subreddit: SubredditId;
    readonly draftRule: CompiledRule;
    readonly windowStart: TimestampMs;
    readonly windowEnd: TimestampMs;
    readonly exampleLimit?: number;
  }): Promise<WhatIfReport> => {
    const events = await deps.events.readWindow({
      subreddit: input.subreddit,
      fromInclusive: input.windowStart,
      toExclusive: input.windowEnd,
    });

    let thingsConsidered = 0;
    let wouldHaveFired = 0;
    let manuallyApproved = 0;
    let removedByOthers = 0;
    const verdictBreakdown: Record<string, number> = {};
    const examples: Array<{
      thingId: ThingId;
      matchedClauseName: string;
      verdict: string;
      explanationShort: string;
    }> = [];
    const exampleCap = input.exampleLimit ?? 8;

    const factsNeeded = factsReferencedBy([input.draftRule]);

    // Track activity per thing so we can infer manual-approval and
    // other-rule-removed signals from the event log.
    const perThing = new Map<
      ThingId,
      {
        factSnapshot: Record<string, string | number | boolean>;
        manuallyApproved: boolean;
        removedByOther: boolean;
      }
    >();

    for (const event of events) {
      if (isEventKind(event, 'ShadowDecisionRecorded') || isEventKind(event, 'ActionTaken')) {
        const thingId = event.payload.thingId;
        const existing = perThing.get(thingId) ?? {
          factSnapshot: {} as Record<string, string | number | boolean>,
          manuallyApproved: false,
          removedByOther: false,
        };
        existing.factSnapshot = { ...existing.factSnapshot, ...event.payload.factBagSnapshot };
        if (isEventKind(event, 'ActionTaken') && event.payload.verdict.kind === 'remove') {
          existing.removedByOther = true;
        }
        if (isEventKind(event, 'ActionTaken') && event.payload.verdict.kind === 'approve') {
          existing.manuallyApproved = true;
        }
        perThing.set(thingId, existing);
      }
      if (isEventKind(event, 'ActionReversed')) {
        const thingId = event.payload.thingId;
        const existing = perThing.get(thingId);
        if (existing) {
          existing.manuallyApproved = true;
          perThing.set(thingId, existing);
        }
      }
    }

    const draftRuleIdBrand = brandRuleId('what-if-draft');
    for (const [thingId, history] of perThing.entries()) {
      thingsConsidered += 1;
      // only count facts the draft rule cares about
      const reducedFacts: Record<string, string | number | boolean> = {};
      for (const f of factsNeeded) {
        if (history.factSnapshot[f] !== undefined) {
          reducedFacts[f] = history.factSnapshot[f] as string | number | boolean;
        }
      }
      const bag = reconstructFactBag(reducedFacts, thingId, input.windowEnd);
      const verdict = evaluateRule(draftRuleIdBrand, input.draftRule, bag);
      if (verdict) {
        wouldHaveFired += 1;
        verdictBreakdown[verdict.verdict.kind] = (verdictBreakdown[verdict.verdict.kind] ?? 0) + 1;
        if (history.manuallyApproved) manuallyApproved += 1;
        if (history.removedByOther) removedByOthers += 1;
        if (examples.length < exampleCap) {
          examples.push({
            thingId,
            matchedClauseName: verdict.matchedClauseName,
            verdict: verdict.verdict.kind,
            explanationShort: verdict.explanation.shortLine,
          });
        }
      }
    }

    // Compare to current live rules
    const active = await deps.activeRules.readActive(input.subreddit);
    const comparisons: WhatIfReport['comparisonToActiveRules'] = active.rules
      .map((rule) => {
        let overlapCount = 0;
        for (const [thingId, history] of perThing.entries()) {
          const reducedFacts: Record<string, string | number | boolean> = {};
          for (const f of factsNeeded) {
            if (history.factSnapshot[f] !== undefined) {
              reducedFacts[f] = history.factSnapshot[f] as string | number | boolean;
            }
          }
          const bag = reconstructFactBag(reducedFacts, thingId, input.windowEnd);
          const otherVerdict = evaluateRule(
            rule.id,
            {
              schemaVersion: 1,
              title: rule.title,
              description: rule.description,
              englishSource: '',
              clauses: latestClauses(rule) as CompiledRule['clauses'],
              compilerConfidence: 1,
            },
            bag,
          );
          const draftVerdict = evaluateRule(draftRuleIdBrand, input.draftRule, bag);
          if (otherVerdict && draftVerdict) overlapCount += 1;
        }
        const percent =
          wouldHaveFired === 0 ? 0 : Math.round((overlapCount / wouldHaveFired) * 100);
        return { activeRuleId: rule.id as string, overlapCount, overlapPercent: percent };
      })
      .filter((c) => c.overlapCount > 0)
      .sort((a, b) => b.overlapPercent - a.overlapPercent);

    return {
      draftRuleId: 'what-if-draft',
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      thingsConsidered,
      thingsThatWouldHaveFired: wouldHaveFired,
      thingsManuallyApprovedByMods: manuallyApproved,
      thingsRemovedByOtherRules: removedByOthers,
      verdictBreakdown,
      examples,
      comparisonToActiveRules: comparisons,
    };
  },
});

export type WhatIfStudio = ReturnType<typeof buildWhatIfStudio>;

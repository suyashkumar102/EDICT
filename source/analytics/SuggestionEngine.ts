import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { Clock } from '@shared/utilities/Clock';
import { mintUlid } from '@shared/utilities/Ulid';
import { isEventKind } from '@domain/events/DomainEvent';
import { buildConfidence } from '@domain/values/ConfidenceScore';
import {
  brandTimestampMs,
  type SubredditId,
  type TimestampMs,
  type ULID,
} from '@shared/types/BrandedPrimitives';

/**
 * SuggestionEngine — mines audit history to propose new rules.
 *
 * The algorithm (intentionally simple — anything heavier is fragile):
 *   1. Read the last 30 days of ActionTaken events with kind=remove that
 *      were NOT reversed.
 *   2. Group by the *first three* of their fact-bag values, looking for
 *      clusters of >= 5 removals with the same fact signature.
 *   3. For each cluster, propose an English rule that summarises the
 *      pattern, e.g. "Posts under 50 chars from accounts younger than
 *      7 days were removed 8 times manually. Add this as a rule?"
 *
 * The output is a SuggestionGenerated event with `proposedEnglish`. The
 * Command Center "Suggestions" tab reads recent SuggestionGenerated
 * events and offers a one-click "Compose this rule" button — which
 * pre-fills the Rule Composer's English field.
 *
 * What this is NOT: it does not use the LLM to generate the suggestion
 * (the LLM is only for compile-time). The natural-language rendering
 * is template-based; the moderator does the final wording.
 */

const FACT_LABEL: Record<string, string> = {
  postLengthChars: 'a post shorter than',
  commentLengthChars: 'a comment shorter than',
  accountAgeDays: 'an account younger than',
  authorKarma: 'an author with karma below',
  uniqueReporterCount: 'three or more unique reporters',
  reportCount: 'multiple reports',
  hasLink: 'a post containing a link',
  titleAllCaps: 'an all-caps title',
};

const renderSuggestion = (
  signature: readonly [string, string | number | boolean][],
  count: number,
): string => {
  const facts = signature.map(([fact, value]) => {
    const label = FACT_LABEL[fact] ?? fact;
    if (typeof value === 'boolean') return label;
    return `${label} ${value}`;
  });
  return `Removed ${count} posts in the last 30 days matching: ${facts.join(' AND ')}. Consider a rule.`;
};

export const buildSuggestionEngine = (deps: {
  readonly events: EventStore;
  readonly clock: Clock;
}) => ({
  generate: async (subreddit: SubredditId): Promise<readonly ULID[]> => {
    const now = deps.clock.now();
    const windowStart = brandTimestampMs(now - 30 * 24 * 60 * 60 * 1000);
    const events = await deps.events.readWindow({
      subreddit,
      fromInclusive: windowStart,
      toExclusive: brandTimestampMs(now + 1),
    });

    const reversedActionIds = new Set<string>();
    for (const event of events) {
      if (isEventKind(event, 'ActionReversed')) {
        reversedActionIds.add(event.payload.originalActionEventId);
      }
    }

    const clusters = new Map<
      string,
      {
        signature: readonly [string, string | number | boolean][];
        count: number;
        sourceIds: ULID[];
      }
    >();
    for (const event of events) {
      if (!isEventKind(event, 'ActionTaken')) continue;
      if (event.payload.verdict.kind !== 'remove') continue;
      if (reversedActionIds.has(event.eventId)) continue;
      // Pick a 3-fact signature ordered by fact name to be stable.
      const facts = Object.entries(event.payload.factBagSnapshot).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (facts.length === 0) continue;
      const signature = facts.slice(0, 3) as [string, string | number | boolean][];
      const key = JSON.stringify(signature);
      const existing = clusters.get(key);
      if (existing) {
        existing.count += 1;
        existing.sourceIds.push(event.eventId);
      } else {
        clusters.set(key, { signature, count: 1, sourceIds: [event.eventId] });
      }
    }

    const suggestionsCreated: ULID[] = [];
    for (const cluster of clusters.values()) {
      if (cluster.count < 5) continue; // significance threshold
      const proposedEnglish = renderSuggestion(cluster.signature, cluster.count);
      const suggestionId = mintUlid(() => now);
      await deps.events.append({
        eventId: suggestionId,
        subreddit,
        occurredAt: now,
        actor: 'system',
        payload: {
          kind: 'SuggestionGenerated',
          suggestionId,
          basedOnReversals: cluster.sourceIds,
          proposedEnglish,
          estimatedCatchRate: buildConfidence(Math.min(0.95, cluster.count / 20)),
        },
      });
      suggestionsCreated.push(suggestionId);
    }

    return suggestionsCreated;
  },
});

export type SuggestionEngine = ReturnType<typeof buildSuggestionEngine>;

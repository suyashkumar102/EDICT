import { Devvit, useAsync } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';
import { auditTimelineKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Suggestions panel. Reads SuggestionGenerated events from the audit
 * timeline and renders each one as an actionable card.
 */

interface Suggestion {
  readonly suggestionId: string;
  readonly proposedEnglish: string;
  readonly basedOnReversals: readonly string[];
  readonly estimatedCatchRate: number;
}

interface AuditEntryRaw {
  readonly eventId: string;
  readonly kind: string;
  readonly summary: string;
  readonly estimatedCatchRate?: number;
}

export const SuggestionsPanel = ({ context }: { context: Devvit.Context }) => {
  const { data, loading } = useAsync(async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    const key = auditTimelineKey(sub);
    const raw = await context.redis.zRange(key, 0, 49, { by: 'rank', reverse: true });
    const entries = raw.map((r) => JSON.parse(r.member) as AuditEntryRaw);
    return entries
      .filter((e) => e.kind === 'SuggestionGenerated')
      .map((e) => ({
        suggestionId: e.eventId,
        proposedEnglish: e.summary,
        basedOnReversals: [] as string[],
        estimatedCatchRate: e.estimatedCatchRate ?? 0.8,
      } satisfies Suggestion));
  });

  if (loading) return <text color={color.textMuted}>Reading suggestions…</text>;
  const suggestions = data ?? [];

  if (suggestions.length === 0) {
    return (
      <vstack gap="medium" alignment="center middle" padding="large">
        <text size="large" weight={typography.weightBold} color={color.textBody}>
          No suggestions yet
        </text>
        <text size="medium" color={color.textMuted}>
          EDICT mines your audit log for removal patterns. Once at least 5 manual
          removals share a fact-bag signature, you'll see a suggestion here.
        </text>
      </vstack>
    );
  }

  return (
    <vstack gap="medium">
      {suggestions.map((s) => (
        <vstack
          gap="small"
          padding="medium"
          backgroundColor={color.surfaceCard}
          cornerRadius="medium"
          border="thin"
          borderColor={color.edictPrimary}
        >
          <hstack gap="small" alignment="start middle">
            <text size="small" weight={typography.weightBold} color={color.edictPrimary}>
              SUGGESTED RULE
            </text>
            <text size="small" color={color.textMuted}>
              · Est. catch rate: {Math.round(s.estimatedCatchRate * 100)}%
            </text>
          </hstack>
          <text size="medium" color={color.textBody}>
            {s.proposedEnglish}
          </text>
          <hstack gap="small" alignment="end middle">
            <button appearance="primary" onPress={() => context.ui.navigateTo(`/edict/compose?prefill=${encodeURIComponent(s.proposedEnglish)}`)}>
              Compose this rule
            </button>
            <button appearance="plain" onPress={() => context.ui.navigateTo(`/edict/suggestion/dismiss/${s.suggestionId}`)}>
              Dismiss
            </button>
          </hstack>
        </vstack>
      ))}
    </vstack>
  );
};

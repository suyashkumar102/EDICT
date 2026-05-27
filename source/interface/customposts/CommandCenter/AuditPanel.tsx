import { Devvit, useAsync, useState } from '@devvit/public-api';
import type { JSONValue } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';
import { auditTimelineKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Audit timeline panel. Streams from AuditTimelineProjection.
 *
 * The header has a filter row (All / Lifecycle / Action / Safety) so a
 * mod can drill down on, e.g., "show me only the actions I might want
 * to reverse" without scrolling past schema-validation events.
 *
 * Each row is a one-liner. Clicking it expands an inline detail box
 * showing the full explanation trace + a "Reverse this" button if
 * within the rollback window.
 */

interface AuditEntry {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly category: 'lifecycle' | 'action' | 'safety';
  readonly kind: string;
  readonly ruleId: string | null;
  readonly thingId: string | null;
  readonly summary: string;
}

const CategoryDot = ({ category }: { category: AuditEntry['category'] }) => {
  const c =
    category === 'action' ? color.semanticInfo : category === 'safety' ? color.semanticDanger : color.textMuted;
  return <vstack width="8px" height="8px" backgroundColor={c} cornerRadius="full" />;
};

export const AuditPanel = ({ context }: { context: Devvit.Context }) => {
  const [filter, setFilter] = useState<'all' | 'lifecycle' | 'action' | 'safety'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const loader: () => Promise<JSONValue> = async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    const key = auditTimelineKey(sub);
    const raw = await context.redis.zRange(key, 0, 99, { by: 'rank', reverse: true });
    return raw.map((r) => JSON.parse(r.member) as AuditEntry) as unknown as JSONValue;
  };
  const { data, loading } = useAsync(loader, { depends: filter });

  const entries = ((data as unknown as AuditEntry[]) ?? []).filter(
    (e) => filter === 'all' || e.category === filter,
  );

  return (
    <vstack gap="medium">
      <hstack gap="small">
        <button appearance={filter === 'all' ? 'primary' : 'plain'} onPress={() => setFilter('all')}>
          All
        </button>
        <button appearance={filter === 'lifecycle' ? 'primary' : 'plain'} onPress={() => setFilter('lifecycle')}>
          Lifecycle
        </button>
        <button appearance={filter === 'action' ? 'primary' : 'plain'} onPress={() => setFilter('action')}>
          Action
        </button>
        <button appearance={filter === 'safety' ? 'primary' : 'plain'} onPress={() => setFilter('safety')}>
          Safety
        </button>
      </hstack>

      {loading ? (
        <text color={color.textMuted}>Loading…</text>
      ) : (
        <vstack gap="small">
          {entries.map((entry: AuditEntry) => (
            <vstack
              gap="small"
              padding="small"
              backgroundColor={color.surfaceCard}
              cornerRadius="medium"
              border="thin"
              borderColor={color.borderSubtle}
              onPress={() => setExpanded(expanded === entry.eventId ? null : entry.eventId)}
            >
              <hstack gap="small" alignment="start middle">
                <CategoryDot category={entry.category} />
                <text size="small" color={color.textMuted}>
                  {new Date(entry.occurredAt).toLocaleString()}
                </text>
                <text size="medium" color={color.textBody}>
                  {entry.summary}
                </text>
              </hstack>
              {expanded === entry.eventId && (
                <vstack
                  gap="small"
                  padding="medium"
                  backgroundColor={color.surfaceRaised}
                  cornerRadius="medium"
                >
                  <text size="small" weight={typography.weightBold}>
                    Event: {entry.kind}
                  </text>
                  <text size="small" color={color.textMuted}>
                    Rule: {entry.ruleId ?? '—'} · Thing: {entry.thingId ?? '—'}
                  </text>
                  {entry.category === 'action' && entry.thingId && (
                    <button
                      appearance="destructive"
                      onPress={() =>
                        context.ui.navigateTo(`/edict/reverse/${entry.eventId}`)
                      }
                    >
                      Reverse this decision
                    </button>
                  )}
                </vstack>
              )}
            </vstack>
          ))}
        </vstack>
      )}
    </vstack>
  );
};

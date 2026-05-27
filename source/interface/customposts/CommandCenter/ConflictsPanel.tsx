import { Devvit, useAsync } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';
import { conflictMapKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Conflicts panel. Reads from ConflictMapProjection.
 *
 * Conflicts are grouped by kind:
 *   • Contradiction — two rules disagree on the same thing
 *   • Overlap       — two rules will fire on the same thing identically
 *   • Shadowing     — one rule's WHEN is a subset of another's
 */

interface ConflictRecord {
  readonly leftRule: string;
  readonly rightRule: string;
  readonly kind: 'overlap' | 'contradiction' | 'shadowing';
  readonly description: string;
}

const conflictColor = (k: ConflictRecord['kind']): string => {
  if (k === 'contradiction') return color.semanticDanger;
  if (k === 'shadowing') return color.semanticWarn;
  return color.semanticInfo;
};

export const ConflictsPanel = ({ context }: { context: Devvit.Context }) => {
  const { data, loading } = useAsync(async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    const key = conflictMapKey(sub);
    // Conflicts stored as a sorted set, member = "leftRule|rightRule|kind|description"
    const members = await context.redis.zRange(key, 0, -1, { by: 'rank' });
    return members.map((m) => {
      const [leftRule, rightRule, kind, ...descParts] = m.member.split('|');
      return {
        leftRule: leftRule ?? '',
        rightRule: rightRule ?? '',
        kind: (kind ?? 'overlap') as ConflictRecord['kind'],
        description: descParts.join('|'),
      } satisfies ConflictRecord;
    });
  });

  if (loading) return <text color={color.textMuted}>Scanning…</text>;
  const conflicts = data ?? [];
  if (conflicts.length === 0) {
    return (
      <vstack gap="medium" alignment="center middle" padding="large">
        <text size="xxlarge" color={color.semanticGood}>
          ✓
        </text>
        <text size="large" weight={typography.weightBold} color={color.textBody}>
          No conflicts detected
        </text>
        <text size="medium" color={color.textMuted}>
          Your rule set is clean. EDICT re-scans on every compile and amend.
        </text>
      </vstack>
    );
  }

  return (
    <vstack gap="medium">
      {conflicts.map((c) => (
        <vstack
          gap="small"
          padding="medium"
          backgroundColor={color.surfaceCard}
          cornerRadius="medium"
          border="thin"
          borderColor={conflictColor(c.kind)}
        >
          <hstack gap="small" alignment="start middle">
            <hstack padding="small" backgroundColor={conflictColor(c.kind)} cornerRadius="full">
              <text size="small" color={color.textInverse} weight={typography.weightBold}>
                {c.kind.toUpperCase()}
              </text>
            </hstack>
            <text size="medium" weight={typography.weightBold} color={color.textBody}>
              {c.leftRule} ↔ {c.rightRule}
            </text>
          </hstack>
          <text size="small" color={color.textBody}>
            {c.description}
          </text>
          <hstack gap="small" alignment="end middle">
            <button appearance="plain" onPress={() => context.ui.navigateTo(`/edict/rule/${c.leftRule}`)}>
              Open A
            </button>
            <button appearance="plain" onPress={() => context.ui.navigateTo(`/edict/rule/${c.rightRule}`)}>
              Open B
            </button>
            <button appearance="bordered" onPress={() => context.ui.navigateTo(`/edict/conflict/resolve/${c.leftRule}/${c.rightRule}`)}>
              Mark resolved
            </button>
          </hstack>
        </vstack>
      ))}
    </vstack>
  );
};

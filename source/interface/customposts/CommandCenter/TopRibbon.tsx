import { Devvit } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';

/**
 * The Command Center's top ribbon — a row of high-density stat tiles
 * showing the subreddit's current state at a glance:
 *
 *   [ Active rules ]  [ Shadow ]  [ Conflicts ]  [ Last briefing ]
 *
 * The ribbon doesn't navigate; clicking a tile is a future enhancement
 * (would switch the active tab). For v1 we kept it read-only to reduce
 * UI surface area and avoid the "did I just click something dangerous?"
 * anxiety in dashboards.
 */

interface Digest {
  readonly activeRuleCount: number;
  readonly shadowRuleCount: number;
  readonly conflictCount: number;
  readonly latestBriefingSummary: string;
  readonly topRule: { readonly ruleId: string; readonly title: string } | null;
}

interface TopRibbonProps {
  readonly digest: Digest | null | undefined;
  readonly loading: boolean;
}

const Tile = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <vstack
    grow
    gap="small"
    padding="medium"
    backgroundColor={color.surfaceCard}
    cornerRadius="medium"
    border="thin"
    borderColor={color.borderSubtle}
  >
    <text size="small" color={color.textMuted} weight={typography.weightMedium}>
      {label}
    </text>
    <text size="xxlarge" weight={typography.weightBold} color={accent}>
      {value}
    </text>
  </vstack>
);

export const TopRibbon = ({ digest, loading }: TopRibbonProps) => {
  if (loading || !digest) {
    return (
      <hstack gap="medium">
        <text size="medium" color={color.textMuted}>Loading Command Center…</text>
      </hstack>
    );
  }

  return (
    <vstack gap="medium">
      <hstack gap="small" alignment="start middle">
        <text size="xxlarge" weight={typography.weightBold} color={color.edictPrimary}>
          EDICT
        </text>
        <text size="medium" color={color.textMuted}>
          Command Center
        </text>
      </hstack>
      <hstack gap="medium">
        <Tile label="Active rules" value={String(digest.activeRuleCount)} accent={color.edictPrimary} />
        <Tile label="In shadow" value={String(digest.shadowRuleCount)} accent={color.semanticWarn} />
        <Tile label="Conflicts" value={String(digest.conflictCount)} accent={digest.conflictCount > 0 ? color.semanticDanger : color.textMuted} />
        <Tile label="Last hour" value={digest.latestBriefingSummary} accent={color.semanticInfo} />
      </hstack>
      {digest.topRule && (
        <hstack gap="small" alignment="start middle">
          <text size="small" color={color.textMuted}>★ Top performer:</text>
          <text size="small" weight={typography.weightBold} color={color.edictPrimary}>
            {digest.topRule.title}
          </text>
        </hstack>
      )}
    </vstack>
  );
};

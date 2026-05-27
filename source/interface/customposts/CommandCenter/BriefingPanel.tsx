import { Devvit, useAsync } from '@devvit/public-api';
import type { JSONValue } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';
import { briefingFeedKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Briefing panel. "What happened since you were last here."
 *
 * Reads the last 24 briefings (each is an hour window). Renders a
 * vertical timeline with each briefing as a stacked card. Anomalies
 * surface in a red sidebar; non-anomalous hours collapse to a single
 * line.
 *
 * This is the screen a mod opens at start-of-shift. The goal is one
 * scroll to "I know what's been happening".
 */

interface BriefingSnapshot {
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly actionsTaken: number;
  readonly shadowDecisions: number;
  readonly reversals: number;
  readonly anomalies: readonly string[];
  readonly topRules: readonly { readonly ruleId: string; readonly matchCount: number }[];
}

const HourLine = ({ briefing }: { briefing: BriefingSnapshot }) => {
  const hasAnomalies = briefing.anomalies.length > 0;
  return (
    <hstack
      gap="medium"
      padding="medium"
      backgroundColor={hasAnomalies ? color.surfaceRaised : color.surfaceCard}
      cornerRadius="medium"
      border="thin"
      borderColor={hasAnomalies ? color.semanticDanger : color.borderSubtle}
    >
      <vstack width="80px" gap="small">
        <text size="small" color={color.textMuted}>
          {new Date(briefing.windowStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </text>
        <text size="xxlarge" weight={typography.weightBold} color={color.edictPrimary}>
          {briefing.actionsTaken}
        </text>
        <text size="small" color={color.textMuted}>
          actions
        </text>
      </vstack>

      <vstack grow gap="small">
        <hstack gap="medium">
          <text size="small" color={color.textMuted}>
            Shadow: {briefing.shadowDecisions}
          </text>
          <text size="small" color={briefing.reversals > 0 ? color.semanticWarn : color.textMuted}>
            Reversed: {briefing.reversals}
          </text>
        </hstack>

        {briefing.topRules.length > 0 && (
          <text size="small" color={color.textBody}>
            ⬆ {briefing.topRules.map((r) => `${r.ruleId} (${r.matchCount})`).join(' · ')}
          </text>
        )}

        {briefing.anomalies.length > 0 && (
          <vstack gap="small" padding="small" backgroundColor={color.surfaceCanvas} cornerRadius="medium">
            <text size="small" weight={typography.weightBold} color={color.semanticDanger}>
              Anomalies this hour
            </text>
            {briefing.anomalies.map((a) => (
              <text size="small" color={color.textBody}>
                • {a}
              </text>
            ))}
          </vstack>
        )}
      </vstack>
    </hstack>
  );
};

export const BriefingPanel = ({ context }: { context: Devvit.Context }) => {
  const loader: () => Promise<JSONValue> = async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    const key = briefingFeedKey(sub);
    const raw = await context.redis.zRange(key, 0, 23, { by: 'rank', reverse: true });
    return raw.map((r) => JSON.parse(r.member) as BriefingSnapshot) as unknown as JSONValue;
  };
  const { data, loading } = useAsync(loader);

  if (loading) return <text color={color.textMuted}>Loading briefings…</text>;
  const briefings = (data as unknown as BriefingSnapshot[]) ?? [];

  if (briefings.length === 0) {
    return (
      <vstack gap="medium" alignment="center middle" padding="large">
        <text size="large" weight={typography.weightBold} color={color.textBody}>
          No briefings yet
        </text>
        <text size="medium" color={color.textMuted}>
          EDICT prepares an hourly briefing once your sub has any active rule.
        </text>
      </vstack>
    );
  }

  return (
    <vstack gap="small">
      {briefings.map((b: BriefingSnapshot) => (
        <HourLine briefing={b} />
      ))}
    </vstack>
  );
};

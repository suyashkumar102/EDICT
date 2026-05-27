import { Devvit, useAsync, useState } from '@devvit/public-api';
import type { JSONValue } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';

/**
 * What-If Studio custom post.
 *
 * Top section: a rule picker + window slider (1..30 days).
 * Middle:      Replay button → fires the simulator.
 * Bottom:      Results card with gauges and example matches.
 */

interface WhatIfReportShape {
  readonly thingsConsidered: number;
  readonly thingsThatWouldHaveFired: number;
  readonly thingsManuallyApprovedByMods: number;
  readonly thingsRemovedByOtherRules: number;
  readonly verdictBreakdown: Readonly<Record<string, number>>;
  readonly examples: readonly {
    readonly thingId: string;
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

const Gauge = ({ pct, accent, label }: { pct: number; accent: string; label: string }) => (
  <vstack gap="small" alignment="center middle" padding="medium">
    <text size="xxlarge" weight={typography.weightBold} color={accent}>
      {pct}%
    </text>
    <text size="small" color={color.textMuted}>
      {label}
    </text>
  </vstack>
);

export const WhatIfStudioPost: Devvit.CustomPostComponent = (context) => {
  const [ruleId, setRuleId] = useState<string>('');
  const [windowDays, setWindowDays] = useState<number>(30);
  const [hasRun, setHasRun] = useState<boolean>(false);

  const loader: () => Promise<JSONValue> = async () => {
    if (!hasRun || !ruleId) return null;
    const key = `edict:whatif:${context.subredditName ?? ''}:${ruleId}`;
    const json = await context.redis.get(key);
    if (!json) return null;
    try {
      return JSON.parse(json) as JSONValue;
    } catch {
      return null;
    }
  };
  const { data: report, loading } = useAsync(loader, { depends: `${hasRun}:${ruleId}:${windowDays}` });

  const firedPct = (() => {
    const r = report as unknown as WhatIfReportShape | null;
    if (!r || r.thingsConsidered === 0) return 0;
    return Math.round((r.thingsThatWouldHaveFired / r.thingsConsidered) * 100);
  })();
  const fpPct = (() => {
    const r = report as unknown as WhatIfReportShape | null;
    if (!r || r.thingsThatWouldHaveFired === 0) return 0;
    return Math.round((r.thingsManuallyApprovedByMods / r.thingsThatWouldHaveFired) * 100);
  })();

  return (
    <vstack gap="medium" padding="medium" backgroundColor={color.surfaceCanvas}>
      <hstack gap="small" alignment="start middle">
        <text size="xxlarge" weight={typography.weightBold} color={color.edictPrimary}>
          What-If Studio
        </text>
        <text size="medium" color={color.textMuted}>
          Replay a draft rule against the last {windowDays} days of event history.
        </text>
      </hstack>

      <vstack
        gap="small"
        padding="medium"
        backgroundColor={color.surfaceCard}
        cornerRadius="medium"
        border="thin"
        borderColor={color.borderSubtle}
      >
        <text size="medium" weight={typography.weightBold}>Replay configuration</text>
        <hstack gap="medium" alignment="start middle">
          <text size="small">Rule ID:</text>
          <button appearance="bordered" onPress={() => context.ui.navigateTo('/edict/whatif/pick-rule')}>
            {ruleId || 'Pick a draft rule…'}
          </button>
          <text size="small">Window:</text>
          <button appearance="plain" onPress={() => setWindowDays(7)}>
            7d
          </button>
          <button appearance="plain" onPress={() => setWindowDays(14)}>
            14d
          </button>
          <button appearance="plain" onPress={() => setWindowDays(30)}>
            30d
          </button>
        </hstack>
        <hstack gap="small" alignment="end middle">
          <button
            appearance="primary"
            onPress={() => {
              if (ruleId) setHasRun(true);
            }}
          >
            Run replay
          </button>
        </hstack>
      </vstack>

      {loading && hasRun && <text color={color.textMuted}>Replaying {windowDays} days of events…</text>}

      {!loading && report && (
        <vstack
          gap="medium"
          padding="medium"
          backgroundColor={color.surfaceCard}
          cornerRadius="medium"
          border="thin"
          borderColor={color.borderSubtle}
        >
          <hstack gap="medium" alignment="start middle">
            <Gauge pct={firedPct} accent={color.edictPrimary} label="would have fired" />
            <Gauge pct={fpPct} accent={fpPct > 25 ? color.semanticDanger : color.semanticGood} label="of those, mod-approved" />
            <Gauge
              pct={
                (report as unknown as WhatIfReportShape).thingsThatWouldHaveFired === 0
                  ? 0
                  : Math.round(
                      ((report as unknown as WhatIfReportShape).thingsRemovedByOtherRules /
                        (report as unknown as WhatIfReportShape).thingsThatWouldHaveFired) * 100,
                    )
              }
              accent={color.semanticInfo}
              label="already caught by another rule"
            />
          </hstack>

          <text size="medium" weight={typography.weightBold}>Examples</text>
          <vstack gap="small">
            {(report as unknown as WhatIfReportShape).examples.map((ex) => (
              <vstack
                padding="small"
                backgroundColor={color.surfaceCanvas}
                cornerRadius="medium"
                gap="small"
              >
                <text size="small" weight={typography.weightBold}>
                  {ex.matchedClauseName}
                </text>
                <text size="small" color={color.textBody}>
                  {ex.explanationShort}
                </text>
                <text size="small" color={color.textMuted}>
                  Would have: {ex.verdict} · t3/{ex.thingId.slice(0, 8)}
                </text>
              </vstack>
            ))}
          </vstack>
        </vstack>
      )}
    </vstack>
  );
};

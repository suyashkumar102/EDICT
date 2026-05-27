import { Devvit, useAsync } from '@devvit/public-api';
import { color, typography, gradeColor } from '@interface/theme/DesignTokens';
import { effectivenessLeaderKey, activeRulesKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';
import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';

/**
 * Effectiveness leaderboard panel.
 *
 * Two sections side-by-side:
 *   Top performers  — rules where score > 0.85
 *   Retire candidates — rules where score < 0.5 and matches > 10
 */

interface LeaderEntry {
  readonly ruleId: string;
  readonly title: string;
  readonly matches: number;
  readonly reversals: number;
  readonly score: number;
  readonly grade: string;
}

const HorizontalBar = ({ value, max, color: barColor }: { value: number; max: number; color: string }) => {
  const widthPct = Math.max(2, Math.round((value / Math.max(1, max)) * 100));
  return (
    <hstack grow alignment="start middle">
      <vstack height="4px" width={`${widthPct}%`} backgroundColor={barColor} cornerRadius="full" />
    </hstack>
  );
};

const Row = ({ entry, max, accent }: { entry: LeaderEntry; max: number; accent: string }) => (
  <vstack
    gap="small"
    padding="small"
    cornerRadius="medium"
    border="thin"
    borderColor={color.borderSubtle}
    backgroundColor={color.surfaceCard}
  >
    <hstack gap="small" alignment="start middle">
      <vstack grow>
        <text size="medium" weight={typography.weightBold} color={color.textBody}>
          {entry.title}
        </text>
        <text size="small" color={color.textMuted}>
          {entry.matches} matches, {entry.reversals} reversed · {entry.grade}
        </text>
      </vstack>
      <text size="large" weight={typography.weightBold} color={accent}>
        {Math.round(entry.score * 100)}%
      </text>
    </hstack>
    <HorizontalBar value={entry.matches} max={max} color={accent} />
  </vstack>
);

export const LeaderboardPanel = ({ context }: { context: Devvit.Context }) => {
  const { data, loading } = useAsync(async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    // Read effectiveness scores from sorted set
    const scoreEntries = await context.redis.zRange(effectivenessLeaderKey(sub), 0, 19, {
      by: 'rank',
      reverse: true,
    });
    // Read rule titles from active rules hash
    const allRulesJson = await context.redis.hGetAll(activeRulesKey(sub));
    const ruleMap = new Map<string, RuleAggregate>();
    for (const [id, json] of Object.entries(allRulesJson)) {
      try {
        ruleMap.set(id, JSON.parse(json) as RuleAggregate);
      } catch { /* skip */ }
    }

    return scoreEntries.map((e) => {
      const rule = ruleMap.get(e.member);
      const score = e.score ?? 0;
      const matches = rule?.effectiveness?.matches ?? 0;
      const reversals = rule?.effectiveness?.reversals ?? 0;
      const grade =
        score >= 0.95 ? 'excellent' :
        score >= 0.85 ? 'strong' :
        score >= 0.7 ? 'fair' :
        score >= 0.5 ? 'weak' : 'failing';
      return {
        ruleId: e.member,
        title: rule?.title ?? e.member,
        matches,
        reversals,
        score,
        grade,
      } satisfies LeaderEntry;
    });
  });

  if (loading) return <text color={color.textMuted}>Loading leaderboard…</text>;
  const list = data ?? [];
  const top = list.filter((e) => e.score >= 0.85);
  const retire = list.filter((e) => e.score < 0.5 && e.matches > 10);
  const maxMatches = Math.max(1, ...list.map((e) => e.matches));

  return (
    <hstack gap="medium">
      <vstack grow gap="small">
        <text size="large" weight={typography.weightBold} color={color.semanticGood}>
          ★ Top performers
        </text>
        {top.length === 0 ? (
          <text size="small" color={color.textMuted}>
            No rules have crossed the 85% effectiveness threshold yet.
          </text>
        ) : (
          top.map((entry) => (
            <Row entry={entry} max={maxMatches} accent={gradeColor(entry.grade)} />
          ))
        )}
      </vstack>

      <vstack grow gap="small">
        <text size="large" weight={typography.weightBold} color={color.semanticDanger}>
          ⚠ Consider retiring
        </text>
        {retire.length === 0 ? (
          <text size="small" color={color.textMuted}>
            Nothing needs retiring — every rule is pulling its weight.
          </text>
        ) : (
          retire.map((entry) => (
            <Row entry={entry} max={maxMatches} accent={gradeColor(entry.grade)} />
          ))
        )}
      </vstack>
    </hstack>
  );
};

import { Devvit, useAsync } from '@devvit/public-api';
import type { JSONValue } from '@devvit/public-api';
import { color, typography, phaseColor } from '@interface/theme/DesignTokens';
import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';
import { activeRulesKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

/**
 * Active Rules panel. Lists every rule the subreddit has — drafted,
 * shadowed, live, paused, archived. Each card surfaces:
 *
 *   • Title + short description
 *   • Phase pill (color-coded: shadow=amber, live=emerald, paused=grey)
 *   • Stats row: matches, reversals, confidence, last activity
 *   • Inline actions: Activate / Pause / Resume / Reverse-last / Compose-amend
 *
 * The card layout deliberately matches Reddit's mod queue card pattern,
 * so mods who already use Reddit's mod tools don't have to learn a new
 * visual language.
 *
 * Sorting: live first (most matches descending), then shadow, then
 * paused, then archived. The user can pin a specific rule to the top
 * via the per-card menu (v1.1 roadmap; v1.0 ships with the default sort).
 */

interface RuleSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly phase: string;
  readonly currentVersion: number;
  readonly observations: number;
  readonly effectivenessScore: number | null;
  readonly lastActivity: number;
}

const PhasePill = ({ phase }: { phase: string }) => (
  <hstack
    gap="small"
    padding="small"
    backgroundColor={phaseColor(phase)}
    cornerRadius="full"
    alignment="center middle"
  >
    <text size="small" color={color.textInverse} weight={typography.weightBold}>
      {phase.toUpperCase()}
    </text>
  </hstack>
);

const StatChip = ({ label, value }: { label: string; value: string }) => (
  <vstack gap="small" alignment="start middle" padding="small">
    <text size="small" color={color.textMuted}>{label}</text>
    <text size="medium" weight={typography.weightBold} color={color.textBody}>{value}</text>
  </vstack>
);

const RuleCard = ({ rule, onAction }: { rule: RuleSummary; onAction: (ruleId: string, action: string) => void }) => (
  <vstack
    gap="small"
    padding="medium"
    backgroundColor={color.surfaceCard}
    cornerRadius="medium"
    border="thin"
    borderColor={color.borderSubtle}
  >
    <hstack gap="small" alignment="start middle">
      <vstack grow gap="small">
        <text size="large" weight={typography.weightBold} color={color.textBody}>
          {rule.title}
        </text>
        <text size="small" color={color.textMuted}>
          v{rule.currentVersion} · {rule.description}
        </text>
      </vstack>
      <PhasePill phase={rule.phase} />
    </hstack>

    <hstack gap="medium">
      <StatChip label="Matches" value={String(rule.observations)} />
      <StatChip
        label="Effectiveness"
        value={rule.effectivenessScore !== null ? `${Math.round(rule.effectivenessScore * 100)}%` : '—'}
      />
      <StatChip label="Last activity" value={rule.lastActivity ? new Date(rule.lastActivity).toLocaleTimeString() : 'never'} />
    </hstack>

    <hstack gap="small" alignment="end middle">
      {rule.phase === 'drafted' && (
        <button appearance="primary" onPress={() => onAction(rule.id, 'activate')}>
          Activate
        </button>
      )}
      {rule.phase === 'shadowed' && (
        <button appearance="bordered" onPress={() => onAction(rule.id, 'promote')}>
          Promote to live now
        </button>
      )}
      {rule.phase === 'live' && (
        <button appearance="bordered" onPress={() => onAction(rule.id, 'pause')}>
          Pause
        </button>
      )}
      {rule.phase === 'paused' && (
        <button appearance="bordered" onPress={() => onAction(rule.id, 'resume')}>
          Resume
        </button>
      )}
      <button appearance="plain" onPress={() => onAction(rule.id, 'whatif')}>
        What-if…
      </button>
      <button appearance="plain" onPress={() => onAction(rule.id, 'amend')}>
        Amend
      </button>
      <button appearance="destructive" onPress={() => onAction(rule.id, 'archive')}>
        Archive
      </button>
    </hstack>
  </vstack>
);

export const ActiveRulesPanel = ({ context }: { context: Devvit.Context }) => {
  const loader: () => Promise<JSONValue> = async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    const key = activeRulesKey(sub);
    const all = await context.redis.hGetAll(key);
    return Object.values(all).map((json) => JSON.parse(json) as RuleAggregate) as unknown as JSONValue;
  };
  const { data: rules, loading } = useAsync(loader);

  const handle = (ruleId: string, action: string): void => {
    context.ui.navigateTo(`/edict/action/${action}/${ruleId}`);
  };

  if (loading) {
    return <text color={color.textMuted}>Loading rules…</text>;
  }

  const list: RuleSummary[] = ((rules as unknown as RuleAggregate[]) ?? []).map((r) => ({
    id: String(r.id),
    title: r.title,
    description: r.description,
    phase: r.shadowStatus.phase,
    currentVersion: r.currentVersion,
    observations: r.effectiveness?.matches ?? 0,
    effectivenessScore: r.effectiveness?.score ?? null,
    lastActivity: r.updatedAt,
  }));
  if (list.length === 0) {
    return (
      <vstack gap="medium" alignment="center middle" padding="large">
        <text size="large" weight={typography.weightBold} color={color.textBody}>
          No rules yet
        </text>
        <text size="medium" color={color.textMuted}>
          Compose your first rule in plain English, or import from the gallery.
        </text>
        <hstack gap="small">
          <button appearance="primary" onPress={() => context.ui.navigateTo('/edict/compose')}>
            Compose
          </button>
          <button appearance="bordered" onPress={() => context.ui.navigateTo('/edict/gallery')}>
            Browse gallery
          </button>
        </hstack>
      </vstack>
    );
  }

  return (
    <vstack gap="medium">
      {list.map((rule) => (
        <RuleCard rule={rule} onAction={handle} />
      ))}
    </vstack>
  );
};

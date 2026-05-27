import { Devvit, useState, useAsync } from '@devvit/public-api';
import { color } from '@interface/theme/DesignTokens';
import { TopRibbon } from '@interface/customposts/CommandCenter/TopRibbon';
import { ActiveRulesPanel } from '@interface/customposts/CommandCenter/ActiveRulesPanel';
import { LeaderboardPanel } from '@interface/customposts/CommandCenter/LeaderboardPanel';
import { AuditPanel } from '@interface/customposts/CommandCenter/AuditPanel';
import { BriefingPanel } from '@interface/customposts/CommandCenter/BriefingPanel';
import { ConflictsPanel } from '@interface/customposts/CommandCenter/ConflictsPanel';
import { SuggestionsPanel } from '@interface/customposts/CommandCenter/SuggestionsPanel';
import { activeRulesKey } from '@infrastructure/redis/KeyNamespacing';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

/**
 * EDICT Command Center custom post.
 *
 * Six tabs — each is its own self-contained panel. We use a single
 * useState for the active tab so the user can switch without losing
 * the rest of the UI state (which lives inside each panel).
 */

export type CommandCenterTab =
  | 'rules'
  | 'leaderboard'
  | 'audit'
  | 'briefing'
  | 'conflicts'
  | 'suggestions';

interface TabSpec {
  readonly key: CommandCenterTab;
  readonly label: string;
}

const TABS: readonly TabSpec[] = [
  { key: 'rules', label: 'Rules' },
  { key: 'leaderboard', label: 'Effectiveness' },
  { key: 'audit', label: 'Audit' },
  { key: 'briefing', label: 'Briefing' },
  { key: 'conflicts', label: 'Conflicts' },
  { key: 'suggestions', label: 'Suggestions' },
];

export const CommandCenterPost: Devvit.CustomPostComponent = (context) => {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>('rules');

  const { data: digest, loading: digestLoading } = useAsync(async () => {
    const sub = brandSubredditId(context.subredditName ?? '');
    const key = activeRulesKey(sub);
    const all = await context.redis.hGetAll(key);
    let activeRuleCount = 0;
    let shadowRuleCount = 0;
    for (const v of Object.values(all)) {
      try {
        const a = JSON.parse(v) as { shadowStatus?: { phase?: string } };
        const phase = a.shadowStatus?.phase;
        if (phase === 'live') activeRuleCount += 1;
        if (phase === 'shadowed') shadowRuleCount += 1;
      } catch { /* skip */ }
    }
    return {
      activeRuleCount,
      shadowRuleCount,
      conflictCount: 0,
      latestBriefingSummary: '—',
      topRule: null,
    };
  });

  return (
    <vstack gap="medium" padding="medium" backgroundColor={color.surfaceCanvas}>
      <TopRibbon digest={digest} loading={digestLoading} />

      <hstack gap="small" alignment="start middle">
        {TABS.map((tab) => (
          <button
            appearance={activeTab === tab.key ? 'primary' : 'plain'}
            onPress={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </hstack>

      <vstack
        gap="small"
        padding="medium"
        backgroundColor={color.surfaceCard}
        cornerRadius="medium"
        border="thin"
        borderColor={color.borderSubtle}
      >
        {activeTab === 'rules' && <ActiveRulesPanel context={context} />}
        {activeTab === 'leaderboard' && <LeaderboardPanel context={context} />}
        {activeTab === 'audit' && <AuditPanel context={context} />}
        {activeTab === 'briefing' && <BriefingPanel context={context} />}
        {activeTab === 'conflicts' && <ConflictsPanel context={context} />}
        {activeTab === 'suggestions' && <SuggestionsPanel context={context} />}
      </vstack>

      <hstack gap="small" alignment="end middle">
        <text size="small" color={color.textMuted}>
          EDICT 1.0
        </text>
      </hstack>
    </vstack>
  );
};

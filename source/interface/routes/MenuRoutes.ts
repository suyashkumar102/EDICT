import { Hono } from 'hono';
import type { CompositionRoot } from '@bootstrap/CompositionRoot';
import { moderatorGuard } from '@interface/middleware/ModeratorGuard';
import { getCurrentSubredditName, getCurrentThingId } from '@interface/middleware/DevvitContext';
import {
  brandModeratorId,
  brandRuleId,
  brandSubredditId,
  brandULID,
} from '@shared/types/BrandedPrimitives';
import { mintUlid } from '@shared/utilities/Ulid';
import { getCurrentUserId, getCurrentUsername } from '@interface/middleware/DevvitContext';
import { activeRulesKey } from '@infrastructure/redis/KeyNamespacing';
import type { RuleAggregate } from '@domain/aggregates/RuleAggregate';
import { latestClauses } from '@domain/aggregates/RuleAggregate';

/**
 * Menu routes for `forUserType: moderator`. Each menu entry in devvit.json
 * declares an `endpoint` which lands here. We return a `showForm` action
 * for endpoints that need input, or a `showToast` for direct one-shot
 * actions.
 *
 * `forUserType: moderator` in devvit.json is the gateway-level filter,
 * but it's a UI hint, not server enforcement (audit AUTH-1). The
 * `moderatorGuard` middleware below re-checks the caller's mod status
 * at the application boundary against the cached mod list, refusing
 * with a 403 toast if the caller isn't a current moderator.
 *
 * The four locked top-level menu items (per CUT-LIST.md surface budget):
 *   /open-command-center  · /compose-edict
 *   /reverse-decision     · /explain-decision
 *
 * Three additional endpoints remain as internal-navigation targets
 * launched from inside Command Center, not from the top-level menu:
 *   /open-what-if · /open-gallery · /open-briefing
 *
 * Each handler:
 *   1. moderatorGuard confirms the caller is a current mod
 *   2. dispatches a Command via the bus (if state-changing)
 *   3. returns the next UI surface to show
 */
export const buildMenuRoutes = (root: CompositionRoot): Hono => {
  const app = new Hono();

  app.use('*', moderatorGuard);

  app.post('/open-command-center', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const active = await root.activeRules.readActive(subreddit);

    const live = active.rules.filter((r) => r.shadowStatus.phase === 'live');
    const shadowed = active.rules.filter((r) => r.shadowStatus.phase === 'shadowed');
    const drafted = active.rules.filter((r) => r.shadowStatus.phase === 'drafted');
    const paused = active.rules.filter((r) => r.shadowStatus.phase === 'paused');

    // Build a clean bullet-list description — no raw IDs, one rule per line
    const bullet = (r: (typeof active.rules)[0]) => {
      const obs = r.effectiveness?.matches ?? 0;
      const score = r.effectiveness ? ` · ${Math.round(r.effectiveness.score * 100)}% eff` : '';
      return `• ${r.title}  (${obs} matches${score})`;
    };

    const sections: string[] = [];
    if (live.length) sections.push(`🟢 Live\n${live.map(bullet).join('\n')}`);
    if (shadowed.length) sections.push(`🟡 Shadow\n${shadowed.map(bullet).join('\n')}`);
    if (drafted.length) sections.push(`⚪ Draft\n${drafted.map(bullet).join('\n')}`);
    if (paused.length) sections.push(`⏸ Paused\n${paused.map(bullet).join('\n')}`);
    if (active.rules.length === 0)
      sections.push('No rules yet.\nUse "Compose new rule" to get started.');

    const allRuleOptions = active.rules.map((r) => ({
      label: `${r.title} [${r.shadowStatus.phase}]`,
      value: r.id as string,
    }));

    return c.json({
      showForm: {
        name: 'commandCenterAction',
        form: {
          title: `EDICT Command Center — ${active.rules.length} rule(s)`,
          description: sections.join('\n\n'),
          fields:
            allRuleOptions.length > 0
              ? [
                  {
                    name: 'ruleId',
                    label: 'Select a rule to manage',
                    type: 'select',
                    options: allRuleOptions,
                    required: false,
                  },
                  {
                    name: 'action',
                    label: 'Action to perform',
                    type: 'select',
                    options: [
                      { label: 'Pause rule', value: 'pause' },
                      { label: 'Resume rule', value: 'resume' },
                      { label: 'Archive rule', value: 'archive' },
                      { label: '🗑 Delete permanently', value: 'delete' },
                    ],
                    required: false,
                  },
                ]
              : [],
          acceptLabel: allRuleOptions.length > 0 ? 'Apply action' : 'OK',
        },
      },
    });
  });

  // Command Center form action handler — registered under menu router
  // because devvit.json forms.commandCenterAction → /internal/menu/command-center-action
  app.post('/command-center-action', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{ ruleId?: string | string[]; action?: string | string[] }>();
    console.log(`[edict] command-center-action body=`, JSON.stringify(body));

    // Devvit sends select field values as arrays — unwrap to scalar
    const ruleIdRaw = Array.isArray(body.ruleId) ? body.ruleId[0] : body.ruleId;
    const actionRaw = Array.isArray(body.action) ? body.action[0] : body.action;

    if (!ruleIdRaw || !actionRaw) {
      return c.json({ showToast: { text: 'Select a rule and an action.' } });
    }

    const ruleId = brandRuleId(ruleIdRaw);

    try {
      switch (actionRaw) {
        case 'pause':
          await root.commandBus.dispatch({
            kind: 'PauseRule',
            subreddit,
            actor,
            correlationId: brandULID(mintUlid()),
            ruleId,
          });
          return c.json({ showToast: { text: 'Rule paused.' } });
        case 'resume':
          await root.commandBus.dispatch({
            kind: 'ResumeRule',
            subreddit,
            actor,
            correlationId: brandULID(mintUlid()),
            ruleId,
          });
          return c.json({ showToast: { text: 'Rule resumed.' } });
        case 'archive':
          await root.commandBus.dispatch({
            kind: 'ArchiveRule',
            subreddit,
            actor,
            correlationId: brandULID(mintUlid()),
            ruleId,
            reason: 'archived via Command Center',
          });
          return c.json({ showToast: { text: 'Rule archived.' } });
        case 'promote':
          await root.commandBus.dispatch({
            kind: 'ActivateRule',
            subreddit,
            actor,
            correlationId: brandULID(mintUlid()),
            ruleId,
            consensusMode: 'off',
            enteringPhase: 'live',
          });
          return c.json({ showToast: { text: 'Rule promoted to LIVE.' } });
        case 'delete': {
          console.log(
            `[edict] delete rule: subreddit=${String(subreddit)} ruleId=${ruleIdRaw} key=${activeRulesKey(subreddit)}`,
          );
          await root.redis.hdel(activeRulesKey(subreddit), ruleIdRaw);
          const check = await root.redis.hget(activeRulesKey(subreddit), ruleIdRaw);
          console.log(
            `[edict] delete rule: post-delete check = ${check === null ? 'GONE' : 'STILL EXISTS'}`,
          );
          return c.json({
            showToast: { text: 'Rule permanently deleted. Reopen Command Center to confirm.' },
          });
        }
        default:
          return c.json({ showToast: { text: `Unknown action: ${actionRaw}` } });
      }
    } catch (err) {
      return c.json({ showToast: { text: err instanceof Error ? err.message : 'Action failed.' } });
    }
  });

  app.post('/compose-edict', (c) => {
    return c.json({
      showForm: {
        name: 'composeForm',
        form: {
          title: 'EDICT · Compose new rule',
          description:
            'Write the rule in plain English. Multi-clause is fine. Use UNLESS for exceptions.',
          fields: [
            {
              name: 'englishSource',
              label: 'The rule, in English',
              type: 'paragraph',
              required: true,
            },
            { name: 'title', label: 'Short title (mods see this)', type: 'string', required: true },
            {
              name: 'description',
              label: 'Optional longer description',
              type: 'paragraph',
              required: false,
            },
            {
              name: 'allowRisky',
              label: 'I want to allow risky verdicts (remove/mute/ban) in this rule',
              type: 'boolean',
              defaultValue: false,
            },
          ],
          acceptLabel: 'Compile + What-If',
        },
      },
    });
  });

  app.post('/open-what-if', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const active = await root.activeRules.readActive(subreddit);
    const ruleOptions = active.rules.map((r) => ({
      label: `${r.title} [${r.shadowStatus.phase}]`,
      value: r.id as string,
    }));

    return c.json({
      showForm: {
        name: 'whatIfForm',
        form: {
          title: 'EDICT · What-If Studio',
          description:
            'Replay a rule against the last N days of event history to see what it would have caught — including removed/archived posts.',
          fields: [
            ruleOptions.length > 0
              ? {
                  name: 'ruleId',
                  label: 'Select a rule',
                  type: 'select',
                  options: ruleOptions,
                  required: true,
                }
              : {
                  name: 'ruleId',
                  label: 'Rule ID',
                  type: 'string',
                  required: true,
                  helpText: 'No compiled rules found. Compose and activate a rule first.',
                },
            {
              name: 'windowDays',
              label: 'Lookback window (days, max 30)',
              type: 'number',
              defaultValue: 30,
            },
          ],
          acceptLabel: 'Run What-If',
        },
      },
    });
  });

  app.post('/open-gallery', (c) => {
    // v1.0: gallery is reachable via the `galleryForm` form rather
    // than a custom post. Surface the form here.
    return c.json({
      showForm: {
        name: 'galleryForm',
        form: {
          title: 'EDICT · Template Gallery',
          description: 'Pick a curated starter template to fork into your drafts.',
          fields: [
            {
              name: 'templateSlug',
              label: 'Template slug',
              type: 'string',
              required: true,
              helpText:
                'Examples: low-karma-low-tenure · allcaps-title-lock · short-post-modqueue · banned-elsewhere-recently',
            },
          ],
          acceptLabel: 'Fork to drafts',
        },
      },
    });
  });

  app.post('/open-briefing', (c) => {
    return c.json({
      showToast: {
        text: 'Briefings ship as a scheduled mod-handoff summary — see `briefing-prepare` (hourly). Custom-post UI lands in v1.1.',
      },
    });
  });

  app.post('/reverse-decision', async (c) => {
    const thingId = getCurrentThingId();
    const subreddit = getCurrentSubredditName();

    // Look up the most recent EDICT decision on this thing so we can show context
    const explanation = await root.devvitAdapter.findExplanationForThing(subreddit, thingId);
    const description = explanation
      ? `Decision to reverse: "${explanation.shortLine}"\n\nEDICT will undo this action and log the reversal. Future similar matches will be downweighted.`
      : 'No recent EDICT decision found for this item. If the action was taken recently, try again in a moment.';

    return c.json({
      showForm: {
        name: 'reverseForm',
        form: {
          title: 'Reverse this EDICT decision?',
          description,
          fields: [
            {
              name: 'thingId',
              label: 'Item ID (auto-filled)',
              type: 'string',
              defaultValue: thingId,
            },
            {
              name: 'note',
              label: 'Optional note for the audit log',
              type: 'paragraph',
              required: false,
            },
          ],
          acceptLabel: 'Reverse decision',
        },
      },
    });
  });

  app.post('/explain-decision', async (c) => {
    const thingId = getCurrentThingId();
    const subreddit = getCurrentSubredditName();
    const explanation = await root.devvitAdapter.findExplanationForThing(subreddit, thingId);
    return c.json({
      showToast: explanation
        ? { text: explanation.shortLine }
        : { text: 'No EDICT decision found for this item.' },
    });
  });

  // Demo-mode shortcut: find the most recently drafted rule and activate
  // it directly in `live` phase (skipping shadow). This is what makes the
  // "type a rule, post a triggering post, watch EDICT act" demo arc
  // possible without three menu items + a wait.
  app.post('/activate-latest-live', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());

    const allJson = await root.redis.hgetall(activeRulesKey(subreddit));
    const aggregates = Object.values(allJson)
      .map((j) => JSON.parse(j) as RuleAggregate)
      .filter((a) => a.shadowStatus.phase === 'drafted' || a.shadowStatus.phase === 'paused')
      // Ensure we only activate rules that have successfully compiled
      .filter((a) => latestClauses(a).length > 0)
      .sort((a, b) => b.createdAt - a.createdAt);
    const latest = aggregates[0];
    if (!latest) {
      console.warn(`[edict] activate-latest-live: no compiled drafted rule found for ${subreddit}`);
      return c.json({
        showToast: {
          text: 'No fully compiled rule found. Wait for the compilation toast to succeed before activating.',
        },
      });
    }

    console.log(
      `[edict] activate-latest-live: found latest drafted rule id=${latest.id} title="${latest.title}"`,
    );
    try {
      await root.commandBus.dispatch({
        kind: 'ActivateRule',
        subreddit,
        actor,
        correlationId: brandULID(mintUlid()),
        ruleId: brandRuleId(latest.id),
        consensusMode: 'off',
        enteringPhase: 'live',
      });
      console.log(`[edict] activate-latest-live: success for rule id=${latest.id}`);
      return c.json({
        showToast: {
          text: `Activated "${latest.title}" in LIVE phase. New posts will be evaluated immediately.`,
        },
      });
    } catch (err) {
      console.error(`[edict] activate-latest-live: failed:`, err);
      return c.json({
        showToast: {
          text: err instanceof Error ? `Activate failed: ${err.message}` : 'Activate failed.',
        },
      });
    }
  });

  return app;
};

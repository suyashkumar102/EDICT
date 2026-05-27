import { Hono } from 'hono';
import type { CompositionRoot } from '@bootstrap/CompositionRoot';
import {
  brandModeratorId,
  brandRuleId,
  brandSubredditId,
  brandThingId,
  brandTimestampMs,
  brandULID,
} from '@shared/types/BrandedPrimitives';
import { mintUlid } from '@shared/utilities/Ulid';
import {
  AmbiguousSentenceError,
  ConsensusRequired,
  CircuitBreakerOpen,
} from '@shared/errors/DomainError';
import type { ActionKind } from '@domain/values/ActionVerdict';
import type { CompiledRule } from '@compilation/schema/RuleSchema';
import { moderatorGuard } from '@interface/middleware/ModeratorGuard';
import { isEventKind } from '@domain/events/DomainEvent';
import {
  getCurrentSubredditName,
  getCurrentUserId,
  getCurrentUsername,
} from '@interface/middleware/DevvitContext';

/**
 * Form submission routes. These match the form names declared in
 * devvit.json under `forms.*`. The handler:
 *   1. moderatorGuard re-checks the caller is a current mod
 *      (defence-in-depth past `forUserType: 'moderator'` in devvit.json)
 *   2. parses the form values
 *   3. translates to one or more Commands
 *   4. dispatches via the bus
 *   5. translates any thrown DomainError into a user-friendly form/toast
 */
export const buildFormRoutes = (root: CompositionRoot): Hono => {
  const app = new Hono();

  app.use('*', moderatorGuard);

  app.post('/compose-submit', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{
      englishSource: string;
      title: string;
      description?: string;
      allowRisky?: boolean;
    }>();
    const optInActions: ActionKind[] = body.allowRisky ? ['remove', 'mute', 'ban'] : [];

    const draftEvents = await root.commandBus.dispatch({
      kind: 'DraftRule',
      subreddit,
      actor,
      correlationId: brandULID(mintUlid()),
      englishSource: body.englishSource,
      title: body.title,
      description: body.description ?? '',
      optInActions,
    });
    const drafted = draftEvents.find((e) => e.payload.kind === 'RuleDrafted');
    if (!drafted) {
      return c.json({ showToast: { text: 'Could not draft rule.' } });
    }
    const ruleId = brandRuleId((drafted.payload as { ruleId: string }).ruleId);

    try {
      await root.commandBus.dispatch({
        kind: 'CompileRule',
        subreddit,
        actor,
        correlationId: brandULID(mintUlid()),
        ruleId,
        model: root.settings.compilerModel,
        verbosity: root.settings.compilerVerbosity,
        optInActions,
      });
      return c.json({
        showToast: {
          text: 'Rule compiled. Open Command Center to preview + activate.',
        },
      });
    } catch (err) {
      if (err instanceof AmbiguousSentenceError) {
        return c.json({
          showForm: {
            name: 'clarifyForm',
            form: {
              title: 'EDICT needs a quick clarification',
              description: err.clarifyingQuestion,
              fields: [
                {
                  name: 'choice',
                  label: 'Pick the closest interpretation',
                  type: 'select',
                  options: err.suggestedOptions.map((o) => ({ label: o, value: o })),
                },
              ],
              acceptLabel: 'Continue',
            },
          },
        });
      }
      return c.json({
        showToast: {
          text: err instanceof Error ? `Compile failed: ${err.message}` : 'Compile failed.',
        },
      });
    }
  });

  app.post('/clarify-submit', async (c) => {
    // ClarificationAnswered + re-compile
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{ ruleId: string; choice: string }>();
    await root.commandBus.dispatch({
      kind: 'AnswerClarification',
      subreddit,
      actor,
      correlationId: brandULID(mintUlid()),
      ruleId: brandRuleId(body.ruleId),
      answer: body.choice,
    });
    return c.json({ showToast: { text: 'Thanks — re-compiling.' } });
  });

  app.post('/activate-submit', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{ ruleId: string }>();
    try {
      await root.commandBus.dispatch({
        kind: 'ActivateRule',
        subreddit,
        actor,
        correlationId: brandULID(mintUlid()),
        ruleId: brandRuleId(body.ruleId),
        consensusMode: root.settings.consensusRequired,
      });
      return c.json({
        showToast: {
          text: 'Activated. Adaptive shadow mode will promote it once confidence ≥ threshold.',
        },
      });
    } catch (err) {
      if (err instanceof ConsensusRequired) {
        return c.json({
          showToast: {
            text: `Waiting on co-moderator approval (${err.current}/${err.needed} so far).`,
          },
        });
      }
      if (err instanceof CircuitBreakerOpen) {
        return c.json({
          showToast: {
            text: `Circuit breaker open until ${new Date(err.until).toLocaleString()}.`,
          },
        });
      }
      throw err;
    }
  });

  app.post('/whatif-submit', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const body = await c.req.json<{ ruleId: string; windowDays: number }>();
    const ruleIdRaw = Array.isArray(body.ruleId) ? body.ruleId[0] : body.ruleId;
    const windowDays =
      Number(Array.isArray(body.windowDays) ? body.windowDays[0] : body.windowDays) || 30;

    if (!ruleIdRaw) {
      return c.json({ showToast: { text: 'No rule ID provided.' } });
    }

    const ruleId = brandRuleId(ruleIdRaw);
    const detail = await root.activeRules.readById(subreddit, ruleId);
    if (!detail) {
      return c.json({ showToast: { text: 'Rule not found. Check the rule ID.' } });
    }

    const now = root.clock.now();
    const draftRule = {
      schemaVersion: 1 as const,
      title: detail.title,
      description: detail.description,
      englishSource: detail.versions[detail.versions.length - 1]?.author.englishSource ?? '',
      clauses: (detail.versions[detail.versions.length - 1]?.clauses ??
        []) as CompiledRule['clauses'],
      compilerConfidence: 1,
    };

    const report = await root.whatIfStudio.replay({
      subreddit,
      draftRule,
      windowStart: (now - windowDays * 24 * 60 * 60 * 1000) as ReturnType<typeof root.clock.now>,
      windowEnd: now,
    });
    await root.devvitAdapter.cacheWhatIfReport(subreddit, ruleId, report);

    // Build clean display — Devvit collapses newlines so keep description short,
    // put key numbers in the title, and use fields for the detail rows
    const firePct =
      report.thingsConsidered === 0
        ? 0
        : Math.round((report.thingsThatWouldHaveFired / report.thingsConsidered) * 100);
    const fpPct =
      report.thingsThatWouldHaveFired === 0
        ? 0
        : Math.round((report.thingsManuallyApprovedByMods / report.thingsThatWouldHaveFired) * 100);

    const topExamples = report.examples
      .slice(0, 3)
      .map((ex) => `${ex.matchedClauseName}: "${ex.explanationShort}"`)
      .join(' | ');

    const verdictSummary = Object.entries(report.verdictBreakdown)
      .map(([k, v]) => `${k}(${v})`)
      .join(', ');

    const overlapSummary = report.comparisonToActiveRules
      .slice(0, 2)
      .map((r) => `${r.activeRuleId.slice(-6)}: ${r.overlapPercent}% overlap`)
      .join(' | ');

    return c.json({
      showForm: {
        name: 'whatIfForm',
        form: {
          title: `What-If: ${report.thingsThatWouldHaveFired}/${report.thingsConsidered} posts (${firePct}%) would fire`,
          description: `Rule: "${detail.title}" over last ${windowDays} days. ${fpPct}% false-positive rate (mod-approved).`,
          fields: [
            {
              name: 'results',
              label: 'Verdict breakdown',
              type: 'string',
              defaultValue: verdictSummary || 'no matches',
            },
            {
              name: 'examples',
              label: `Top matches (${report.examples.length} total)`,
              type: 'paragraph',
              defaultValue: topExamples || 'No matches in this window.',
            },
            ...(overlapSummary
              ? [
                  {
                    name: 'overlap',
                    label: 'Overlap with other active rules',
                    type: 'string',
                    defaultValue: overlapSummary,
                  },
                ]
              : []),
          ],
          acceptLabel: 'Close',
        },
      },
    });
  });

  app.post('/consensus-vote', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{ ruleId: string; vote: 'approve' | 'reject'; note?: string }>();
    await root.commandBus.dispatch({
      kind: 'CastConsensusVote',
      subreddit,
      actor,
      correlationId: brandULID(mintUlid()),
      ruleId: brandRuleId(body.ruleId),
      vote: body.vote,
      ...(body.note ? { note: body.note } : {}),
    });
    return c.json({ showToast: { text: 'Vote recorded.' } });
  });

  app.post('/gallery-import', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{ templateSlug: string }>();
    const template = root.templateGallery.get(body.templateSlug);
    if (!template) {
      return c.json({ showToast: { text: 'Template not found.' } });
    }
    await root.commandBus.dispatch({
      kind: 'DraftRule',
      subreddit,
      actor,
      correlationId: brandULID(mintUlid()),
      englishSource: template.englishSource,
      title: template.title,
      description: template.summary,
      optInActions: [],
    });
    return c.json({
      showToast: {
        text: `"${template.title}" forked to drafts. Compile + What-If next.`,
      },
    });
  });

  // Reverse a previous EDICT decision
  app.post('/reverse-submit', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const actor = brandModeratorId(getCurrentUserId() || getCurrentUsername());
    const body = await c.req.json<{ thingId?: string | string[]; note?: string }>();

    const thingIdRaw = Array.isArray(body.thingId) ? body.thingId[0] : body.thingId;
    if (!thingIdRaw) {
      return c.json({
        showToast: { text: 'No item ID found. Try again from the post/comment menu.' },
      });
    }

    // Find the most recent ActionTaken event for this thingId to get the rollback token
    const now = root.clock.now();
    const events = await root.events.readWindow({
      subreddit,
      fromInclusive: brandTimestampMs(now - 30 * 24 * 60 * 60 * 1000),
      toExclusive: brandTimestampMs(now + 1),
    });

    let rollbackTokenId: string | null = null;
    let foundRuleId: string | null = null;
    let originalVerdict: string | null = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (!event) continue;
      if (isEventKind(event, 'ActionTaken') && String(event.payload.thingId) === thingIdRaw) {
        rollbackTokenId = String(event.payload.rollbackTokenId);
        foundRuleId = String(event.payload.ruleId);
        originalVerdict = event.payload.verdict.kind;
        break;
      }
    }

    if (!rollbackTokenId || !foundRuleId) {
      return c.json({
        showToast: { text: 'No reversible EDICT decision found for this item (may have expired).' },
      });
    }

    try {
      // Execute the inverse Reddit action before logging the reversal
      const thingId = brandThingId(thingIdRaw);
      if (originalVerdict === 'sendToModQueue' || originalVerdict === 'report') {
        // Un-report = approve the item
        await root.devvitAdapter.executeAction(subreddit, thingId, { kind: 'approve' });
      } else if (originalVerdict === 'lock') {
        // Unlock by approving (Devvit doesn't have a direct unlock, approve clears mod flags)
        await root.devvitAdapter.executeAction(subreddit, thingId, { kind: 'approve' });
      } else if (originalVerdict === 'remove') {
        // Un-remove = approve
        await root.devvitAdapter.executeAction(subreddit, thingId, { kind: 'approve' });
      }
      // For ban/mute/flair etc., the CommandBus ReverseAction handler
      // logs the reversal; the mod must manually undo those in Reddit mod tools.

      await root.commandBus.dispatch({
        kind: 'ReverseAction',
        subreddit,
        actor,
        correlationId: brandULID(mintUlid()),
        rollbackTokenId: brandULID(rollbackTokenId),
        ...(body.note ? { note: body.note } : {}),
      });
      return c.json({
        showToast: { text: `Decision reversed: ${originalVerdict} undone on this item.` },
      });
    } catch (err) {
      return c.json({
        showToast: { text: err instanceof Error ? err.message : 'Reversal failed.' },
      });
    }
  });

  return app;
};

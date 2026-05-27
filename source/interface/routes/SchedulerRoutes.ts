import { Hono } from 'hono';
import type { CompositionRoot } from '@bootstrap/CompositionRoot';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';
import { getCurrentSubredditName } from '@interface/middleware/DevvitContext';

/**
 * Scheduler routes. Devvit calls these on the cron expressions declared
 * in devvit.json under `scheduler.tasks`.
 *
 * Each handler is idempotent and tolerant of being run twice — Devvit
 * doesn't guarantee exactly-once.
 */
export const buildSchedulerRoutes = (root: CompositionRoot): Hono => {
  const app = new Hono();

  app.post('/shadow-sweep', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const result = await root.adaptiveShadow.sweep(subreddit, {
      threshold: root.settings.shadowConfidenceThreshold,
      minObservations: root.settings.shadowMinObservations,
      hardCapMs: root.settings.shadowMaxHours * 60 * 60 * 1000,
    });
    return c.json(result);
  });

  app.post('/breaker-tick', (c) => {
    // No-op: the breaker is reset implicitly when its counter key TTLs.
    // This endpoint exists so the scheduler can probe the app, and for
    // future per-rule recovery logic.
    return c.json({ ok: true });
  });

  app.post('/effectiveness-recompute', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const result = await root.effectivenessScorer.recompute(subreddit, 14 * 24 * 60 * 60 * 1000);
    return c.json(result);
  });

  app.post('/compaction', async (c) => {
    // For each subreddit, drop & rebuild the active-rules projection
    // from the event log. Bounds projection drift if any event was
    // missed by a momentary handler failure.
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const events = await root.events.readBefore({
      subreddit,
      beforeExclusive: root.clock.now(),
    });
    const written = await root.activeRules.rebuildFromEvents(subreddit, events);
    return c.json({ rebuilt: written });
  });

  app.post('/briefing-prepare', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    await root.briefingComposer.prepare(subreddit);
    return c.json({ ok: true });
  });

  app.post('/rollback-sweep', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    const decayed = await root.undoLearning.decayAll(subreddit);
    return c.json({ decayed });
  });

  app.post('/seed-templates', async (c) => {
    const subreddit = brandSubredditId(getCurrentSubredditName());
    await root.devvitAdapter.seedOnInstall(subreddit);
    return c.json({ ok: true });
  });

  return app;
};

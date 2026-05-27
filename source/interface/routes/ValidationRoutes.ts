import { Hono } from 'hono';

/**
 * Settings validation endpoints. Devvit calls these when a moderator
 * changes a setting value. We reject obviously-broken inputs at the form
 * level so they never persist.
 */
export const buildValidationRoutes = (): Hono => {
  const app = new Hono();

  app.post('/confidence', async (c) => {
    const body = await c.req.json<{ value: number }>();
    if (body.value < 0.5 || body.value > 1) {
      return c.json({ success: false, message: 'Confidence threshold must be between 0.5 and 1.' });
    }
    return c.json({ success: true });
  });

  app.post('/observations', async (c) => {
    const body = await c.req.json<{ value: number }>();
    if (!Number.isInteger(body.value) || body.value < 5 || body.value > 500) {
      return c.json({
        success: false,
        message: 'Observations must be an integer between 5 and 500.',
      });
    }
    return c.json({ success: true });
  });

  app.post('/duration', async (c) => {
    const body = await c.req.json<{ value: number }>();
    if (body.value < 1 || body.value > 168) {
      return c.json({ success: false, message: 'Duration must be between 1 and 168 hours.' });
    }
    return c.json({ success: true });
  });

  app.post('/ceiling', async (c) => {
    const body = await c.req.json<{ value: number }>();
    if (!Number.isInteger(body.value) || body.value < 1 || body.value > 10000) {
      return c.json({ success: false, message: 'Ceiling must be an integer between 1 and 10000.' });
    }
    return c.json({ success: true });
  });

  app.post('/rollout', async (c) => {
    const body = await c.req.json<{ value: number }>();
    if (!Number.isInteger(body.value) || body.value < 0 || body.value > 100) {
      return c.json({
        success: false,
        message: 'Rollout percent must be an integer between 0 and 100.',
      });
    }
    return c.json({ success: true });
  });

  app.post('/window', async (c) => {
    const body = await c.req.json<{ value: number }>();
    if (!Number.isInteger(body.value) || body.value < 1 || body.value > 90) {
      return c.json({ success: false, message: 'Rollback window must be 1–90 days.' });
    }
    return c.json({ success: true });
  });

  return app;
};

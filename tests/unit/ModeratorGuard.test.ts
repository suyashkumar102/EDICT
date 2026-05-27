import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ModeratorGuard middleware reads from `@devvit/web/server`'s
 * `context`, `reddit`, and `redis`. We mock the whole module before
 * importing the guard so the test runs in-process, without a Devvit
 * runtime. The mock returns whatever the test set on the shared
 * `mockState` object.
 */

interface MockState {
  contextSubreddit?: string;
  contextUsername?: string;
  modlistCache?: string | null;
  modlistFromApi?: readonly string[] | 'throw';
}
const mockState: MockState = {};

vi.mock('@devvit/web/server', () => ({
  context: new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'subredditName') return mockState.contextSubreddit;
        if (key === 'username') return mockState.contextUsername;
        return undefined;
      },
    },
  ),
  reddit: {
    getModerators: ({ subredditName: _ }: { subredditName: string }) => {
      if (mockState.modlistFromApi === 'throw') throw new Error('rpc-unreachable');
      const list = mockState.modlistFromApi ?? [];
      return {
        all: async () => list.map((username) => ({ username })),
      };
    },
  },
  redis: {
    get: async (_key: string) => mockState.modlistCache ?? null,
    set: async () => undefined,
  },
}));

// Imports MUST come after vi.mock — Vitest hoists vi.mock above top-level
// imports automatically, but keeping these here documents intent.
import { Hono } from 'hono';
import { moderatorGuard } from '@interface/middleware/ModeratorGuard';

const buildApp = (): Hono => {
  const app = new Hono();
  app.use('*', moderatorGuard);
  app.post('/probe', (c) => c.json({ ok: true, allowed: true }));
  return app;
};

beforeEach(() => {
  delete mockState.contextSubreddit;
  delete mockState.contextUsername;
  mockState.modlistCache = null;
  mockState.modlistFromApi = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('moderatorGuard', () => {
  it('refuses 401 when no subreddit in context', async () => {
    mockState.contextUsername = 'alice';
    const res = await buildApp().request('/probe', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('refuses 401 when no username in context', async () => {
    mockState.contextSubreddit = 'edictplayground';
    const res = await buildApp().request('/probe', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('refuses 403 when caller is not on the mod list', async () => {
    mockState.contextSubreddit = 'edictplayground';
    mockState.contextUsername = 'someone-else';
    mockState.modlistFromApi = ['alice', 'bob'];
    const res = await buildApp().request('/probe', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('allows when caller is on the mod list (fresh from API)', async () => {
    mockState.contextSubreddit = 'edictplayground';
    mockState.contextUsername = 'alice';
    mockState.modlistFromApi = ['alice', 'bob'];
    const res = await buildApp().request('/probe', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowed: boolean };
    expect(body.allowed).toBe(true);
  });

  it('allows when caller is on the cached mod list', async () => {
    mockState.contextSubreddit = 'edictplayground';
    mockState.contextUsername = 'carol';
    mockState.modlistCache = JSON.stringify(['carol', 'dave']);
    mockState.modlistFromApi = 'throw'; // ensure the cache is what's read
    const res = await buildApp().request('/probe', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('falls back to gateway filter when both redis and reddit fail', async () => {
    mockState.contextSubreddit = 'edictplayground';
    mockState.contextUsername = 'eve';
    mockState.modlistCache = null;
    mockState.modlistFromApi = 'throw';
    const res = await buildApp().request('/probe', { method: 'POST' });
    // Fallback path: trust the gateway-level forUserType filter.
    expect(res.status).toBe(200);
  });
});

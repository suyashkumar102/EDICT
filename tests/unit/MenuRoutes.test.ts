import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MenuRoutes smoke tests. We mock `@devvit/web/server` so the
 * moderatorGuard middleware lets the request through, then verify each
 * of the four trimmed menu endpoints returns the expected response
 * shape (a `showForm` / `navigateTo` / `showToast` envelope).
 */

interface MockState {
  modlist: readonly string[];
  caller: string;
  sub: string;
}
const mockState: MockState = {
  modlist: ['mod-alice'],
  caller: 'mod-alice',
  sub: 'edictplayground',
};

vi.mock('@devvit/web/server', () => ({
  context: new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'subredditName') return mockState.sub;
        if (key === 'username') return mockState.caller;
        return undefined;
      },
    },
  ),
  reddit: {
    getModerators: () => ({
      all: async () => mockState.modlist.map((username) => ({ username })),
    }),
  },
  redis: {
    get: async () => null,
    set: async () => undefined,
  },
}));

import { Hono } from 'hono';
import { buildMenuRoutes } from '@interface/routes/MenuRoutes';
import type { CompositionRoot } from '@bootstrap/CompositionRoot';

const stubAdapter = {
  executeAction: async () => undefined,
  ensureCommandCenterPostUrl: async (sub: string) => `https://reddit.com/r/${sub}/comments/cc`,
  ensureGalleryPostUrl: async (sub: string) => `https://reddit.com/r/${sub}/comments/gallery`,
  ensureBriefingPostUrl: async (sub: string) => `https://reddit.com/r/${sub}/comments/briefing`,
  findExplanationForThing: async () => null,
  cacheWhatIfReport: async () => undefined,
  readCachedWhatIfReport: async () => null,
  seedOnInstall: async () => undefined,
};

const fakeRoot = {
  devvitAdapter: stubAdapter,
  activeRules: {
    readActive: async () => ({ rules: [] }),
  },
} as unknown as CompositionRoot;

const buildApp = (): Hono => {
  const app = new Hono();
  app.route('/internal/menu', buildMenuRoutes(fakeRoot));
  return app;
};

beforeEach(() => {
  mockState.modlist = ['mod-alice'];
  mockState.caller = 'mod-alice';
  mockState.sub = 'edictplayground';
});

describe('MenuRoutes', () => {
  it('open-command-center returns a showForm with rule list', async () => {
    const res = await buildApp().request('/internal/menu/open-command-center', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showForm?: { name: string; form: { title: string } } };
    expect(body.showForm?.name).toBe('commandCenterAction');
    expect(body.showForm?.form.title).toContain('EDICT Command Center');
  });

  it('compose-edict returns a showForm with the right form name', async () => {
    const res = await buildApp().request('/internal/menu/compose-edict', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showForm?: { name: string } };
    expect(body.showForm?.name).toBe('composeForm');
  });

  it('reverse-decision returns a showForm', async () => {
    const res = await buildApp().request('/internal/menu/reverse-decision', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showForm?: unknown };
    expect(body.showForm).toBeTruthy();
  });

  it('explain-decision returns a showToast', async () => {
    const res = await buildApp().request('/internal/menu/explain-decision', {
      method: 'POST',
      headers: { 'x-devvit-thing-id': 't3_demo' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showToast?: unknown };
    expect(body.showToast).toBeTruthy();
  });

  it('refuses 403 when caller is not a moderator', async () => {
    mockState.caller = 'someone-else';
    const res = await buildApp().request('/internal/menu/open-command-center', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('refuses 401 when no subreddit in context', async () => {
    mockState.sub = '';
    const res = await buildApp().request('/internal/menu/open-command-center', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

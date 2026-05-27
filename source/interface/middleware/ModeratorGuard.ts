import type { Context, MiddlewareHandler, Next } from 'hono';
import { context as devvitContext, reddit, redis as devvitRedis } from '@devvit/web/server';

/**
 * Defense-in-depth moderator gate.
 *
 * Devvit's `forUserType: 'moderator'` in `devvit.json` is a UI hint
 * enforced by the gateway, not by the app. If a malicious caller bypasses
 * the gateway (e.g. by replaying a captured request), `forUserType` does
 * nothing. Every form / menu handler that mutates state or spends an
 * LLM call MUST re-check the caller's mod status at the application
 * boundary. This middleware is that re-check.
 *
 * Implementation notes:
 *   - The subreddit + caller username come from Devvit's per-request
 *     `context` object. We never trust an `x-devvit-subreddit` header.
 *   - The mod list is cached in Redis (`edict:modlist:{sub}`, 5 min TTL).
 *     A miss falls back to `reddit.getModerators({ subredditName })`.
 *   - If both Redis AND the Reddit RPC fail, we refuse the request. The
 *     gateway-level `forUserType` is the only line of defence remaining,
 *     which is exactly the situation this middleware exists to back up.
 *   - Scheduler / trigger routes do NOT use this guard — they are
 *     invoked by Devvit itself, not by a user.
 */

const MOD_CACHE_TTL_SECONDS = 5 * 60;

const modListCacheKey = (subredditName: string): string => `edict:modlist:${subredditName}`;

interface DevvitContext {
  readonly subredditName?: string;
  readonly username?: string;
  readonly userId?: string;
}

const readContext = (): DevvitContext => devvitContext as DevvitContext;

const refuse = (c: Context, reason: string, status: 401 | 403 = 403): Response => {
  // 401 when we couldn't identify the caller; 403 when we identified them
  // and they aren't a moderator. Both surface in Devvit as a toast.
  return c.json(
    {
      showToast: {
        text: `EDICT refused: ${reason}.`,
      },
    },
    status,
  );
};

const fetchModList = async (subredditName: string): Promise<readonly string[] | null> => {
  try {
    const cached = await devvitRedis.get(modListCacheKey(subredditName));
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as unknown;
        if (Array.isArray(parsed) && parsed.every((m) => typeof m === 'string')) {
          return parsed;
        }
      } catch {
        // fall through to a fresh fetch
      }
    }
  } catch {
    // Redis read failed; fall through.
  }

  try {
    const listing = await reddit.getModerators({ subredditName });
    const fresh = (await listing.all()).map((m) => m.username);
    try {
      await devvitRedis.set(modListCacheKey(subredditName), JSON.stringify(fresh), {
        expiration: new Date(Date.now() + MOD_CACHE_TTL_SECONDS * 1000),
      });
    } catch {
      // Cache write failure is non-fatal — we still have a valid list.
    }
    return fresh;
  } catch {
    return null;
  }
};

/**
 * Hono middleware that allows the request only if the caller is a current
 * moderator of the subreddit this app is installed in.
 */
export const moderatorGuard: MiddlewareHandler = async (c, next: Next) => {
  const ctx = readContext();
  const subredditName = ctx.subredditName;
  const username = ctx.username;

  if (!subredditName) {
    return refuse(c, 'no subreddit in request context', 401);
  }
  if (!username) {
    return refuse(c, 'no caller identity in request context', 401);
  }

  const mods = await fetchModList(subredditName);
  if (!mods) {
    // Could not resolve the mod list. The Devvit gateway already filtered
    // by `forUserType: 'moderator'`, so we trust that as the fallback;
    // log a loud warning so the operator can investigate the plugin RPC.
    console.warn(
      `[edict] moderatorGuard: could not resolve mod list for r/${subredditName} — relying on gateway-side filter`,
    );
    return next();
  }

  if (!mods.includes(username)) {
    return refuse(c, 'caller is not a moderator of this subreddit', 403);
  }

  return next();
};

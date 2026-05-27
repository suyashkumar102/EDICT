import { context as devvitContext } from '@devvit/web/server';

/**
 * Thin helpers over Devvit's per-request `context` object.
 *
 * Devvit injects a request-scoped context into every handler — menu,
 * form, trigger, scheduler — carrying `subredditName`, `subredditId`,
 * `postId`, `commentId`, `userId`, `username`. There is NO HTTP header
 * named `x-devvit-subreddit` or `x-devvit-mod-id`; those were a wrong
 * assumption in an earlier draft of the route code. Reading
 * `context.subredditName` is the documented pattern (see
 * `vibe-mod/docs/devvit-reference.md` and the Devvit web docs).
 *
 * These helpers exist so call-sites don't repeat the `(context as
 * { subredditName?: string }).subredditName || ''` shape and so the
 * tests can mock one place.
 */

interface DevvitRequestContext {
  readonly subredditName?: string;
  readonly subredditId?: string;
  readonly username?: string;
  readonly userId?: string;
  readonly postId?: string;
  readonly commentId?: string;
}

const ctx = (): DevvitRequestContext => devvitContext as DevvitRequestContext;

export const getCurrentSubredditName = (): string => ctx().subredditName ?? '';
export const getCurrentSubredditId = (): string => ctx().subredditId ?? '';
export const getCurrentUsername = (): string => ctx().username ?? '';
export const getCurrentUserId = (): string => ctx().userId ?? '';

/**
 * Returns the post or comment id this request is operating on, if any.
 * Menu items declared with `location: ['post']` or `['comment']` get
 * this populated; subreddit-scoped menu items get empty strings.
 */
export const getCurrentThingId = (): string => ctx().postId || ctx().commentId || '';

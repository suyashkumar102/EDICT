import type { ActionKind } from '@domain/values/ActionVerdict';
import { isCompilerPermitted, requiresExplicitOptIn } from '@domain/values/ActionVerdict';

/**
 * Compiler whitelist policy. The LLM compiler is permitted to emit only
 * SAFE actions (see ActionVerdict). High-impact actions need a separate
 * explicit moderator checkbox in the Rule Composer UI, captured here as
 * an `optInActions: Set<ActionKind>` passed alongside compilation.
 *
 * Rejected verdicts produce a SchemaValidationFailure at compile time, before
 * any storage write. This is the single most important safety property of
 * EDICT — it's the reason a malformed LLM response can never become an
 * active rule.
 */

export interface WhitelistDecision {
  readonly permitted: boolean;
  readonly reason: 'safe-by-default' | 'opted-in' | 'requires-opt-in' | 'unknown-kind';
}

export const decideWhitelist = (
  kind: ActionKind,
  optInActions: ReadonlySet<ActionKind>,
): WhitelistDecision => {
  if (isCompilerPermitted(kind)) {
    return { permitted: true, reason: 'safe-by-default' };
  }
  if (requiresExplicitOptIn(kind)) {
    return optInActions.has(kind)
      ? { permitted: true, reason: 'opted-in' }
      : { permitted: false, reason: 'requires-opt-in' };
  }
  return { permitted: false, reason: 'unknown-kind' };
};

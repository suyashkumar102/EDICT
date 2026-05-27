import type { ModeratorId } from '@shared/types/BrandedPrimitives';
import type { ActionKind } from '@domain/values/ActionVerdict';
import { impactWeight } from '@domain/values/ActionVerdict';

/**
 * Mod-team consensus. Three modes set in subreddit settings:
 *   off:    one mod can activate anything
 *   risky:  any rule that contains an action with impactWeight >= 5 needs 2 mod approvals
 *   strict: every activation needs 2 mod approvals
 *
 * Why 2 (not N): empirical — every mod team beyond 2 has stable cliques and
 * either one ratifies everything (decoration) or two debate (real check).
 * EDICT's setting deliberately reads "1 + at least 1 other" rather than a
 * configurable N to keep the workflow approachable.
 */
export type ConsensusMode = 'off' | 'risky' | 'strict';

export interface ConsensusRequirement {
  readonly required: number;
  readonly reason: 'mode-off' | 'mode-strict' | 'risky-action-detected' | 'low-risk';
}

export const requirementFor = (
  mode: ConsensusMode,
  actionKinds: readonly ActionKind[],
): ConsensusRequirement => {
  if (mode === 'off') return { required: 1, reason: 'mode-off' };
  if (mode === 'strict') return { required: 2, reason: 'mode-strict' };

  const hasRiskyAction = actionKinds.some((k) => impactWeight(k) >= 5);
  return hasRiskyAction
    ? { required: 2, reason: 'risky-action-detected' }
    : { required: 1, reason: 'low-risk' };
};

export interface ConsensusTally {
  readonly approvals: ReadonlySet<ModeratorId>;
  readonly rejections: ReadonlySet<ModeratorId>;
}

export const isSatisfied = (
  requirement: ConsensusRequirement,
  tally: ConsensusTally,
  authoringModerator: ModeratorId,
): boolean => {
  // The author's signature is implicit; we still need `required - 1`
  // additional approvals from *other* moderators.
  const distinctOtherApprovals = Array.from(tally.approvals).filter(
    (m) => m !== authoringModerator,
  ).length;
  return distinctOtherApprovals >= requirement.required - 1 && tally.rejections.size === 0;
};

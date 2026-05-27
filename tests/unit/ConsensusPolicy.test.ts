import { describe, expect, it } from 'vitest';
import { isSatisfied, requirementFor } from '@domain/policies/ConsensusPolicy';
import { brandModeratorId } from '@shared/types/BrandedPrimitives';

describe('ConsensusPolicy.requirementFor', () => {
  it('returns 1 when consensus is off', () => {
    expect(requirementFor('off', ['remove']).required).toBe(1);
  });
  it('returns 2 in strict mode regardless of verdicts', () => {
    expect(requirementFor('strict', ['flair']).required).toBe(2);
    expect(requirementFor('strict', ['ban']).required).toBe(2);
  });
  it('returns 2 in risky mode when any verdict is impact-weight ≥ 5', () => {
    expect(requirementFor('risky', ['ban']).required).toBe(2);
    expect(requirementFor('risky', ['remove']).required).toBe(2);
  });
  it('returns 1 in risky mode when all verdicts are below weight 5', () => {
    expect(requirementFor('risky', ['flair', 'lock', 'sendToModQueue']).required).toBe(1);
  });
});

describe('ConsensusPolicy.isSatisfied', () => {
  const ALICE = brandModeratorId('alice');
  const BOB = brandModeratorId('bob');
  const CARLA = brandModeratorId('carla');

  it('single-required mode is satisfied immediately', () => {
    expect(
      isSatisfied(
        { required: 1, reason: 'mode-off' },
        { approvals: new Set(), rejections: new Set() },
        ALICE,
      ),
    ).toBe(true);
  });

  it('two-required mode needs one OTHER moderator approval (author counts implicitly)', () => {
    expect(
      isSatisfied(
        { required: 2, reason: 'risky-action-detected' },
        { approvals: new Set([ALICE]), rejections: new Set() },
        ALICE,
      ),
    ).toBe(false);
    expect(
      isSatisfied(
        { required: 2, reason: 'risky-action-detected' },
        { approvals: new Set([BOB]), rejections: new Set() },
        ALICE,
      ),
    ).toBe(true);
  });

  it('is not satisfied if any moderator has rejected', () => {
    expect(
      isSatisfied(
        { required: 2, reason: 'risky-action-detected' },
        { approvals: new Set([BOB, CARLA]), rejections: new Set([ALICE]) },
        ALICE,
      ),
    ).toBe(false);
  });
});

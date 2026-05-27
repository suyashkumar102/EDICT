import type { TimestampMs } from '@shared/types/BrandedPrimitives';
import type { ConfidenceScore } from '@domain/values/ConfidenceScore';

/**
 * A rule moves through these phases:
 *
 *   drafted ──► shadowed ──► live
 *                  │            │
 *                  ├──────► paused (manual or breaker)
 *                  ▼            ▼
 *               archived ◄── archived
 *
 * `shadowed` is split from `live` because shadow decisions are logged but not
 * executed; the safety layer's AdaptiveShadowPolicy decides when to promote.
 */
export type RulePhase = 'drafted' | 'shadowed' | 'live' | 'paused' | 'archived';

export interface ShadowStatus {
  readonly phase: RulePhase;
  readonly enteredShadowAt: TimestampMs | null;
  readonly promotedAt: TimestampMs | null;
  readonly observations: number;
  readonly shadowReversals: number;
  readonly currentConfidence: ConfidenceScore | null;
  readonly pauseReason: 'manual' | 'breaker' | 'conflict' | null;
  readonly pausedAt: TimestampMs | null;
}

export const initialShadowStatus = (): ShadowStatus => ({
  phase: 'drafted',
  enteredShadowAt: null,
  promotedAt: null,
  observations: 0,
  shadowReversals: 0,
  currentConfidence: null,
  pauseReason: null,
  pausedAt: null,
});

export const canTakeAction = (status: ShadowStatus): boolean => status.phase === 'live';
export const isObserving = (status: ShadowStatus): boolean => status.phase === 'shadowed';

import { describe, expect, it } from 'vitest';
import { buildConfidence, isPromotable, updateConfidence } from '@domain/values/ConfidenceScore';

describe('ConfidenceScore', () => {
  it('rejects values outside [0,1]', () => {
    expect(() => buildConfidence(-0.1)).toThrow();
    expect(() => buildConfidence(1.1)).toThrow();
    expect(() => buildConfidence(Number.NaN)).toThrow();
  });

  it('accepts the endpoints', () => {
    expect(buildConfidence(0)).toBe(0);
    expect(buildConfidence(1)).toBe(1);
  });

  describe('updateConfidence (Bayesian blend)', () => {
    it('returns the prior when n=0', () => {
      expect(updateConfidence(buildConfidence(0.6), 0, buildConfidence(1))).toBe(0.6);
    });

    it('moves toward the evidence rate as n grows', () => {
      const low = updateConfidence(buildConfidence(0.5), 5, buildConfidence(0.9));
      const high = updateConfidence(buildConfidence(0.5), 500, buildConfidence(0.9));
      expect(high).toBeGreaterThan(low);
      expect(Math.abs(high - 0.9)).toBeLessThan(Math.abs(low - 0.9));
    });

    it('clamps to [0,1]', () => {
      // contrived case — make sure no overflow
      expect(updateConfidence(buildConfidence(1), 50, buildConfidence(1))).toBeLessThanOrEqual(1);
    });
  });

  describe('isPromotable', () => {
    it('promotes only when score ≥ threshold', () => {
      expect(isPromotable(buildConfidence(0.93), buildConfidence(0.92))).toBe(true);
      expect(isPromotable(buildConfidence(0.91), buildConfidence(0.92))).toBe(false);
      expect(isPromotable(buildConfidence(0.92), buildConfidence(0.92))).toBe(true);
    });
  });
});

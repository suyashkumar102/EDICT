import { describe, expect, it } from 'vitest';
import { computeEffectiveness, gradeFor } from '@domain/values/EffectivenessScore';

describe('computeEffectiveness', () => {
  it('returns 1.0 (innocent) when no matches yet', () => {
    expect(
      computeEffectiveness({ matches: 0, reversals: 0, conflictPenalties: 0, computedAt: 0 }).score,
    ).toBe(1);
  });

  it('returns 1.0 when matches and no reversals or conflicts', () => {
    expect(
      computeEffectiveness({ matches: 50, reversals: 0, conflictPenalties: 0, computedAt: 0 })
        .score,
    ).toBe(1);
  });

  it('returns (m - r - c) / m for normal cases', () => {
    const result = computeEffectiveness({
      matches: 100,
      reversals: 20,
      conflictPenalties: 10,
      computedAt: 0,
    });
    expect(result.score).toBe(0.7);
  });

  it('clamps to 0 when reversals + penalties exceed matches', () => {
    const result = computeEffectiveness({
      matches: 10,
      reversals: 8,
      conflictPenalties: 5,
      computedAt: 0,
    });
    expect(result.score).toBe(0);
  });
});

describe('gradeFor', () => {
  it.each([
    [0.99, 'excellent'],
    [0.95, 'excellent'],
    [0.9, 'strong'],
    [0.85, 'strong'],
    [0.75, 'fair'],
    [0.7, 'fair'],
    [0.6, 'weak'],
    [0.5, 'weak'],
    [0.3, 'failing'],
    [0, 'failing'],
  ])('grades score %s as %s', (score, grade) => {
    expect(gradeFor(score as never)).toBe(grade);
  });
});

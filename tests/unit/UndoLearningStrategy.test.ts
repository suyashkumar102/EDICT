import { describe, expect, it } from 'vitest';
import { fingerprintPattern } from '@safety/UndoLearningStrategy';
import { brandSubredditId } from '@shared/types/BrandedPrimitives';

const SUB = brandSubredditId('s');

describe('UndoLearningStrategy.fingerprintPattern', () => {
  it('produces the same fingerprint for the same input', () => {
    const a = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'rule-x',
      clauseName: 'short',
      factSnapshot: { postLengthChars: 30, accountAgeDays: 5 },
    });
    const b = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'rule-x',
      clauseName: 'short',
      factSnapshot: { accountAgeDays: 5, postLengthChars: 30 }, // different insertion order
    });
    expect(a).toBe(b);
  });

  it('differs when the rule changes', () => {
    const a = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'rule-x',
      clauseName: 'short',
      factSnapshot: { postLengthChars: 30 },
    });
    const b = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'rule-y',
      clauseName: 'short',
      factSnapshot: { postLengthChars: 30 },
    });
    expect(a).not.toBe(b);
  });

  it('differs when a fact value changes', () => {
    const a = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'rule-x',
      clauseName: 'short',
      factSnapshot: { postLengthChars: 30 },
    });
    const b = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'rule-x',
      clauseName: 'short',
      factSnapshot: { postLengthChars: 40 },
    });
    expect(a).not.toBe(b);
  });

  it('is an 8-char lowercase hex string', () => {
    const fp = fingerprintPattern({
      subreddit: SUB,
      ruleId: 'r',
      clauseName: 'c',
      factSnapshot: { x: 1 },
    });
    expect(fp).toMatch(/^[a-f0-9]{8}$/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  impactWeight,
  isCompilerPermitted,
  isReversible,
  requiresExplicitOptIn,
} from '@domain/values/ActionVerdict';

describe('ActionVerdict policy queries', () => {
  it('compiler-permitted set is exactly the SAFE actions', () => {
    const safe: readonly string[] = [
      'report',
      'flair',
      'lock',
      'sendToModQueue',
      'approve',
      'sticky',
      'distinguish',
      'commentReply',
      'modmailNotify',
    ];
    for (const k of safe) {
      expect(isCompilerPermitted(k as never)).toBe(true);
      expect(requiresExplicitOptIn(k as never)).toBe(false);
    }
  });

  it('opt-in set is exactly the RISKY actions', () => {
    const risky = ['remove', 'mute', 'ban', 'contributorAdd', 'contributorRemove'] as const;
    for (const k of risky) {
      expect(isCompilerPermitted(k)).toBe(false);
      expect(requiresExplicitOptIn(k)).toBe(true);
    }
  });

  it('impactWeight is monotone in destructiveness', () => {
    expect(impactWeight('report')).toBeLessThan(impactWeight('lock'));
    expect(impactWeight('lock')).toBeLessThan(impactWeight('remove'));
    expect(impactWeight('remove')).toBeLessThan(impactWeight('mute'));
    expect(impactWeight('mute')).toBeLessThan(impactWeight('ban'));
  });

  it('outgoing-message verdicts are NOT reversible', () => {
    expect(isReversible({ kind: 'commentReply', templateId: 'x' })).toBe(false);
    expect(isReversible({ kind: 'modmailNotify', subjectTemplate: 'x' })).toBe(false);
  });

  it('state-change verdicts ARE reversible', () => {
    expect(isReversible({ kind: 'remove', spam: false })).toBe(true);
    expect(isReversible({ kind: 'ban', durationDays: 7, reasonNote: 'x' })).toBe(true);
    expect(isReversible({ kind: 'lock' })).toBe(true);
  });
});

/**
 * The complete set of moderation actions EDICT can take. Ordered loosely from
 * least-invasive (report) to most-invasive (ban). The compiler must produce
 * one of these literals; the schema validator rejects anything else *before*
 * persistence.
 *
 * Two tiers: a SAFE set the compiler may emit freely (report, flair, lock,
 * sendToModQueue, approve, sticky, distinguish, commentReply, modmailNotify)
 * and a RISKY set that requires explicit moderator opt-in (remove, mute,
 * ban*, contributorAdd, contributorRemove). High-impact actions are
 * additionally gated by ConsensusPolicy.
 */
export type ActionVerdict =
  | { kind: 'report'; reasonCode: string }
  | { kind: 'flair'; flairTemplate: string }
  | { kind: 'lock' }
  | { kind: 'sendToModQueue' }
  | { kind: 'remove'; spam: boolean }
  | { kind: 'approve' }
  | { kind: 'sticky'; pinSlot: 1 | 2 }
  | { kind: 'distinguish'; how: 'moderator' | 'admin' }
  | { kind: 'mute'; durationMinutes: 60 | 4320 | 10080 } // 1 h, 3 d, 7 d
  | { kind: 'ban'; durationDays: 1 | 3 | 7 | 30 | 'permanent'; reasonNote: string }
  | { kind: 'contributorAdd' }
  | { kind: 'contributorRemove' }
  | { kind: 'commentReply'; templateId: string }
  | { kind: 'modmailNotify'; subjectTemplate: string };

export type ActionKind = ActionVerdict['kind'];

const SAFE: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'report',
  'flair',
  'lock',
  'sendToModQueue',
  'approve',
  'sticky',
  'distinguish',
  'commentReply',
  'modmailNotify',
]);

const REQUIRES_OPT_IN: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'remove',
  'mute',
  'ban',
  'contributorAdd',
  'contributorRemove',
]);

export const isCompilerPermitted = (kind: ActionKind): boolean => SAFE.has(kind);
export const requiresExplicitOptIn = (kind: ActionKind): boolean => REQUIRES_OPT_IN.has(kind);

export const isReversible = (verdict: ActionVerdict): boolean => {
  switch (verdict.kind) {
    case 'report':
    case 'flair':
    case 'lock':
    case 'sendToModQueue':
    case 'remove':
    case 'approve':
    case 'sticky':
    case 'distinguish':
    case 'mute':
    case 'ban':
    case 'contributorAdd':
    case 'contributorRemove':
      return true;
    case 'commentReply':
    case 'modmailNotify':
      return false; // outgoing messages can't be unsent
  }
};

export const impactWeight = (kind: ActionKind): number => {
  switch (kind) {
    case 'modmailNotify':
    case 'commentReply':
    case 'report':
      return 1;
    case 'flair':
    case 'approve':
    case 'sticky':
    case 'distinguish':
      return 2;
    case 'sendToModQueue':
    case 'lock':
      return 3;
    case 'remove':
    case 'contributorAdd':
      return 5;
    case 'mute':
    case 'contributorRemove':
      return 7;
    case 'ban':
      return 10;
  }
};

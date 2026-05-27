/**
 * Few-shot exemplars passed to the compiler. Each pair is (userMessage,
 * assistantResponseAsToolCall). The exemplar set is intentionally varied:
 *   ex01: trivial single-atom rule  (covers "easy case")
 *   ex02: AND of two atoms          (covers compound condition)
 *   ex03: OR of three atoms         (covers disjunction)
 *   ex04: WHEN ... UNLESS           (covers exception clause)
 *   ex05: multi-clause              (covers sequencing)
 *   ex06: ambiguous → clarify       (covers the clarify path)
 *
 * We DO NOT include examples for risky verbs (ban/remove/mute) — the model
 * sees only safe verbs in the exemplars so the prior is pulled toward safety.
 */

export interface ExemplarTurn {
  readonly user: string;
  readonly toolCallName: 'compileRule' | 'clarify';
  readonly toolCallArguments: Record<string, unknown>;
}

export const EXEMPLARS: readonly ExemplarTurn[] = [
  {
    user: 'Lock any post whose title is in all caps.',
    toolCallName: 'compileRule',
    toolCallArguments: {
      schemaVersion: 1,
      title: 'Lock all-caps titles',
      description: 'Posts with an all-caps title are locked to discourage shouting.',
      englishSource: 'Lock any post whose title is in all caps.',
      compilerConfidence: 0.98,
      tags: ['style', 'titles'],
      clauses: [
        {
          clauseName: 'all-caps title',
          when: {
            kind: 'atom',
            fact: 'titleAllCaps',
            comparator: { kind: 'isTrue' },
            atomId: 'ALLCAPS01',
          },
          verdict: { kind: 'lock' },
        },
      ],
    },
  },
  {
    user: 'Send to mod queue any post under 50 chars from accounts less than 7 days old.',
    toolCallName: 'compileRule',
    toolCallArguments: {
      schemaVersion: 1,
      title: 'Short low-tenure posts → modqueue',
      description: 'Short posts from accounts under one week old are routed for human review.',
      englishSource:
        'Send to mod queue any post under 50 chars from accounts less than 7 days old.',
      compilerConfidence: 0.96,
      tags: ['low-effort', 'low-tenure'],
      clauses: [
        {
          clauseName: 'short post + new account',
          when: {
            kind: 'and',
            children: [
              {
                kind: 'atom',
                fact: 'postLengthChars',
                comparator: { kind: 'lt', value: 50 },
                atomId: 'POSTLEN01',
              },
              {
                kind: 'atom',
                fact: 'accountAgeDays',
                comparator: { kind: 'lt', value: 7 },
                atomId: 'ACCTAGE01',
              },
            ],
          },
          verdict: { kind: 'sendToModQueue' },
        },
      ],
    },
  },
  {
    user: 'Report posts that contain a link to bit.ly or tinyurl.com or t.co.',
    toolCallName: 'compileRule',
    toolCallArguments: {
      schemaVersion: 1,
      title: 'Report URL-shortener links',
      description: 'Posts containing common URL-shortener domains are reported.',
      englishSource: 'Report posts that contain a link to bit.ly or tinyurl.com or t.co.',
      compilerConfidence: 0.94,
      tags: ['spam', 'shorteners'],
      clauses: [
        {
          clauseName: 'shortener link',
          when: {
            kind: 'and',
            children: [
              {
                kind: 'atom',
                fact: 'hasLink',
                comparator: { kind: 'isTrue' },
                atomId: 'HASLINK01',
              },
              {
                kind: 'atom',
                fact: 'domainEqualsAnyOf',
                comparator: { kind: 'in', values: ['bit.ly', 'tinyurl.com', 't.co'] },
                atomId: 'DOMAIN01',
              },
            ],
          },
          verdict: { kind: 'report', reasonCode: 'url-shortener' },
        },
      ],
    },
  },
  {
    user: 'Send to mod queue any post with 3 or more unique reporters, unless the author has positive karma above 1000.',
    toolCallName: 'compileRule',
    toolCallArguments: {
      schemaVersion: 1,
      title: 'Mass-report → modqueue, trusted users exempted',
      description:
        'Posts with three or more unique reporters go to the mod queue except for established accounts.',
      englishSource:
        'Send to mod queue any post with 3 or more unique reporters, unless the author has positive karma above 1000.',
      compilerConfidence: 0.92,
      tags: ['reports', 'trust'],
      clauses: [
        {
          clauseName: 'mass-report exception for trusted',
          when: {
            kind: 'atom',
            fact: 'uniqueReporterCount',
            comparator: { kind: 'gte', value: 3 },
            atomId: 'REPORT01',
          },
          unless: {
            kind: 'atom',
            fact: 'authorKarma',
            comparator: { kind: 'gt', value: 1000 },
            atomId: 'KARMA01',
          },
          verdict: { kind: 'sendToModQueue' },
        },
      ],
    },
  },
  {
    user: 'If a post is under 30 chars send to mod queue. If it is also from an account younger than 24 hours, flair it as "new-user-low-effort". And if its title is in all caps, lock it.',
    toolCallName: 'compileRule',
    toolCallArguments: {
      schemaVersion: 1,
      title: 'Tiered low-effort handling',
      description: 'Three-step escalation on short, new-user, or shouting posts.',
      englishSource:
        'If a post is under 30 chars send to mod queue. If it is also from an account younger than 24 hours, flair it as "new-user-low-effort". And if its title is in all caps, lock it.',
      compilerConfidence: 0.89,
      tags: ['multi-clause', 'low-effort'],
      clauses: [
        {
          clauseName: 'all-caps title → lock',
          when: {
            kind: 'atom',
            fact: 'titleAllCaps',
            comparator: { kind: 'isTrue' },
            atomId: 'ALLCAPS02',
          },
          verdict: { kind: 'lock' },
        },
        {
          clauseName: 'short + new account → flair',
          when: {
            kind: 'and',
            children: [
              {
                kind: 'atom',
                fact: 'postLengthChars',
                comparator: { kind: 'lt', value: 30 },
                atomId: 'POSTLEN02',
              },
              {
                kind: 'atom',
                fact: 'accountAgeDays',
                comparator: { kind: 'lt', value: 1 },
                atomId: 'ACCTAGE02',
              },
            ],
          },
          verdict: { kind: 'flair', flairTemplate: 'new-user-low-effort' },
        },
        {
          clauseName: 'short post → modqueue',
          when: {
            kind: 'atom',
            fact: 'postLengthChars',
            comparator: { kind: 'lt', value: 30 },
            atomId: 'POSTLEN03',
          },
          verdict: { kind: 'sendToModQueue' },
        },
      ],
    },
  },
  {
    user: 'Block low-effort spam from new users.',
    toolCallName: 'clarify',
    toolCallArguments: {
      question:
        'How would you like EDICT to define "low-effort spam from new users"? Multiple thresholds need to be set.',
      options: [
        'Post under 50 chars AND account younger than 7 days → send to mod queue',
        'Post under 30 chars AND account younger than 24 hours → flair as low-effort',
        'Any post from accounts younger than 24 hours containing a link → report',
        'Combine all three as a tiered rule',
      ],
    },
  },
] as const;

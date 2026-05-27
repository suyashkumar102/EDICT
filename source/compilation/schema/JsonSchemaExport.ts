/**
 * Hand-authored JSON Schema mirror of `compiledRuleSchema`, used as the
 * `response_format` for OpenAI structured outputs. Kept hand-authored
 * (rather than auto-converted from Zod) because OpenAI's JSON-Schema
 * dialect rejects some Zod-emitted constructs (e.g. nested discriminators
 * with refinement metadata).
 *
 * If you change `compiledRuleSchema`, you must change this too. A
 * round-trip property test in tests/property/SchemaParity.test.ts asserts
 * that any rule emitted via JSON-Schema-constrained sampling parses
 * cleanly through `compiledRuleSchema`.
 */

const COMPARATOR_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'lt' }, value: { type: 'number' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'lte' }, value: { type: 'number' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'gt' }, value: { type: 'number' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'gte' }, value: { type: 'number' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'min', 'max'],
      properties: { kind: { const: 'between' }, min: { type: 'number' }, max: { type: 'number' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'eq' }, value: { type: ['string', 'number', 'boolean'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'neq' }, value: { type: ['string', 'number', 'boolean'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'values'],
      properties: {
        kind: { const: 'in' },
        values: { type: 'array', items: { type: ['string', 'number'] }, minItems: 1, maxItems: 50 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'pattern', 'caseSensitive'],
      properties: {
        kind: { const: 'matches' },
        pattern: { type: 'string', maxLength: 500 },
        caseSensitive: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'isTrue' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'isFalse' } },
    },
  ],
};

const CONDITION_TREE_SCHEMA = {
  $ref: '#/$defs/conditionTree',
};

export const ruleJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'EDICT compiled rule',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'title',
    'description',
    'englishSource',
    'clauses',
    'compilerConfidence',
  ],
  properties: {
    schemaVersion: { const: 1 },
    title: { type: 'string', minLength: 3, maxLength: 80 },
    description: { type: 'string', minLength: 10, maxLength: 500 },
    englishSource: { type: 'string', minLength: 8, maxLength: 2000 },
    compilerConfidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', pattern: '^[a-z0-9-]{2,30}$' },
    },
    clauses: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clauseName', 'when', 'verdict'],
        properties: {
          clauseName: { type: 'string', minLength: 3, maxLength: 60 },
          comment: { type: 'string', maxLength: 280 },
          when: CONDITION_TREE_SCHEMA,
          unless: CONDITION_TREE_SCHEMA,
          verdict: { $ref: '#/$defs/verdict' },
        },
      },
    },
  },
  $defs: {
    conditionTree: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'fact', 'comparator', 'atomId'],
          properties: {
            kind: { const: 'atom' },
            fact: { type: 'string' },
            comparator: COMPARATOR_SCHEMA,
            atomId: { type: 'string', pattern: '^[A-Z0-9]{6,16}$' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'children'],
          properties: {
            kind: { const: 'and' },
            children: { type: 'array', items: CONDITION_TREE_SCHEMA, minItems: 2, maxItems: 10 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'children'],
          properties: {
            kind: { const: 'or' },
            children: { type: 'array', items: CONDITION_TREE_SCHEMA, minItems: 2, maxItems: 10 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'child'],
          properties: {
            kind: { const: 'not' },
            child: CONDITION_TREE_SCHEMA,
          },
        },
      ],
    },
    verdict: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'reasonCode'],
          properties: {
            kind: { const: 'report' },
            reasonCode: { type: 'string', pattern: '^[a-z0-9-]{2,40}$' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'flairTemplate'],
          properties: {
            kind: { const: 'flair' },
            flairTemplate: { type: 'string', maxLength: 60 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'lock' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'sendToModQueue' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'approve' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'pinSlot'],
          properties: { kind: { const: 'sticky' }, pinSlot: { enum: [1, 2] } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'how'],
          properties: { kind: { const: 'distinguish' }, how: { enum: ['moderator', 'admin'] } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'templateId'],
          properties: {
            kind: { const: 'commentReply' },
            templateId: { type: 'string', maxLength: 60 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'subjectTemplate'],
          properties: {
            kind: { const: 'modmailNotify' },
            subjectTemplate: { type: 'string', maxLength: 80 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'spam'],
          properties: { kind: { const: 'remove' }, spam: { type: 'boolean' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'durationMinutes'],
          properties: { kind: { const: 'mute' }, durationMinutes: { enum: [60, 4320, 10080] } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'durationDays', 'reasonNote'],
          properties: {
            kind: { const: 'ban' },
            durationDays: { enum: [1, 3, 7, 30, 'permanent'] },
            reasonNote: { type: 'string', maxLength: 200 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'contributorAdd' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'contributorRemove' } },
        },
      ],
    },
  },
} as const;

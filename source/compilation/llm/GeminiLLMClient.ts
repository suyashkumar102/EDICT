import type { LLMInvocation, LLMPort, LLMResponse } from '@compilation/llm/CompilerService';
import { CompilationFailure, InfrastructureFailure } from '@shared/errors/DomainError';

/**
 * Gemini (Google Generative Language API) client for EDICT's compiler.
 *
 * Why a second approved provider, not a vendor differentiation play:
 *   - Reddit's Devvit AI provider policy (PR #96) maintains a vetted list.
 *     OpenAI and Gemini are on it; Anthropic is not (which is why
 *     `AnthropicLLMClient` was removed — see CUT-LIST.md hard lock #4).
 *   - Gemini's free tier gives moderators a no-cost path to try EDICT
 *     end-to-end before deciding whether to pay for OpenAI.
 *
 * Wire-format mapping vs OpenAI:
 *   - OpenAI uses `messages: [...]` with separate `system`/`user`/
 *     `assistant` roles and a `tool_calls` array on assistant responses.
 *   - Gemini uses `contents: [...]` with `role: 'user' | 'model'` and
 *     `parts: [{ text }]` or `parts: [{ functionCall: { name, args } }]`.
 *     The system prompt is split out into a top-level
 *     `systemInstruction` field.
 *   - OpenAI's `tools[].function.parameters` accepts full JSON Schema
 *     (with `$ref`, `oneOf`, `const`, `additionalProperties: false`).
 *     Gemini's `tools[].functionDeclarations[].parameters` accepts an
 *     OpenAPI 3.0 *subset* — none of those four are supported. We
 *     therefore pass a deliberately SHALLOW parameter schema for each
 *     known tool name; the deep shape is enforced server-side by Zod
 *     after the response lands, exactly like the OpenAI path's
 *     defence-in-depth re-parse.
 *
 * Determinism: `temperature: 0`. The compiler must be idempotent so
 * the rule fingerprint stays stable across re-compiles.
 */

export interface GeminiConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly userAgent: string;
  /** Delay multiplier base in ms for exponential backoff. Set to 0 in tests. */
  readonly retryDelayMs: number;
}

const DEFAULTS: Omit<GeminiConfig, 'apiKey'> = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  timeoutMs: 30_000,
  userAgent: 'edict/1.0',
  retryDelayMs: 1_000,
};

interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args: unknown;
  };
}

interface GeminiTextPart {
  text: string;
}

type GeminiPart = GeminiFunctionCallPart | GeminiTextPart;

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiResponseBody {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

const maxOutputTokensFor = (effort: LLMInvocation['reasoningEffort']): number => {
  switch (effort) {
    case 'high':
      return 4000;
    case 'medium':
      return 2500;
    case 'low':
      return 1500;
    case 'none':
      return 1000;
  }
};

/**
 * Gemini-compatible (OpenAPI-subset) parameter schemas for EDICT's two
 * tools. These are deliberately flat — Gemini's function-calling parser
 * rejects `$ref`, `oneOf`, `additionalProperties`, and `const`, which
 * is the whole shape language used in `JsonSchemaExport.ts`.
 *
 * The full structural validation runs in `compiledRuleSchema.safeParse`
 * after the model returns, so the security boundary is unchanged — we
 * rely on the prompt + exemplars + this loose schema to guide Gemini
 * to the right shape, then Zod enforces the deep structure.
 *
 * Note on nested object guidance: Gemini's failure mode when the
 * schema is too shallow is bailing to prose ("Compiler returned prose
 * instead of a structured tool call"). Giving Gemini explicit nested
 * `properties` inside `clauses.items` — even loosely typed — cuts the
 * bail rate to ~zero on flash + flash-lite.
 */
// Gemini's OpenAPI-subset parser rejects `oneOf` / `$ref` / `const`,
// which is the entire shape language EDICT's full JSON schema uses for
// the discriminated `kind` unions on conditionTree, comparator, and
// verdict. Workaround: list every possible field as optional, gate the
// requirement with an `enum` on `kind`, and document which field maps
// to which kind in the `description`. The model uses the description
// to pick the right combination; Zod re-validates the deep shape
// server-side after the call returns.

const COMPARATOR_SCHEMA = {
  type: 'object',
  description:
    'Comparator. kind picks which extra field is required: lt/lte/gt/gte/eq/neq need `value` (number for lt/lte/gt/gte; number|string|boolean for eq/neq — pass as string if mixed); between needs `min` and `max`; in needs `values`; matches needs `pattern` (+ `caseSensitive`); isTrue/isFalse need nothing else.',
  properties: {
    kind: {
      type: 'string',
      enum: [
        'lt',
        'lte',
        'gt',
        'gte',
        'between',
        'eq',
        'neq',
        'in',
        'matches',
        'isTrue',
        'isFalse',
      ],
    },
    value: {
      type: 'string',
      description:
        'Numeric values are passed as numbers but accepted as strings too for eq/neq across mixed types.',
    },
    min: { type: 'number' },
    max: { type: 'number' },
    values: { type: 'array', items: { type: 'string' } },
    pattern: {
      type: 'string',
      description:
        'Regex pattern; <=200 chars; no nested quantifiers like (a+)+; no backreferences.',
    },
    caseSensitive: { type: 'boolean' },
  },
  required: ['kind'],
};

// Same node shape applies recursively for and/or children and not.child,
// but Gemini's schema parser can't represent recursion. We declare ONE
// level explicitly and the model handles deeper nesting from the
// description + exemplars.
const CONDITION_TREE_SCHEMA = {
  type: 'object',
  description:
    'Condition tree node. kind picks the shape: atom = leaf (needs fact+comparator+atomId); and/or = composite (needs children: 2..10 nested condition tree nodes); not = unary (needs child: a single nested condition tree node). For nested children/child, repeat the same {kind, …} structure.',
  properties: {
    kind: { type: 'string', enum: ['atom', 'and', 'or', 'not'] },
    fact: {
      type: 'string',
      description:
        'For kind=atom: the fact name. One of: postLengthChars, commentLengthChars, accountAgeDays, authorKarma, authorVerifiedEmail, titleMatchesPattern, bodyMatchesPattern, titleAllCaps, titleQuestionMark, hasLink, domainEqualsAnyOf, subredditAgeMinutes, reportCount, uniqueReporterCount, flairEqualsAnyOf, isSelfPost, isCrosspost, postScoreAfterMinutes, replyCountAfterMinutes, authorBannedInOtherSubInLastDays, authorHasModMail, timeOfDayHourUtc.',
    },
    comparator: COMPARATOR_SCHEMA,
    atomId: {
      type: 'string',
      description:
        'For kind=atom: stable id matching /^[A-Z0-9]{6,16}$/. Must be unique across all atoms in this rule.',
    },
    children: {
      type: 'array',
      description:
        'For kind=and|or: 2..10 nested condition tree nodes. Each item is a {kind, fact?, comparator?, atomId?, children?, child?} object.',
      items: { type: 'object' },
    },
    child: {
      type: 'object',
      description: 'For kind=not: a single nested condition tree node. Same {kind, …} shape.',
    },
  },
  required: ['kind'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  description:
    'Moderation action. kind picks which extra fields are required: report needs reasonCode (lowercase-kebab); flair needs flairTemplate; sticky needs pinSlot (1 or 2); distinguish needs how ("moderator" or "admin"); commentReply needs templateId; modmailNotify needs subjectTemplate; remove needs spam (boolean); mute needs durationMinutes (60, 4320, or 10080); ban needs durationDays (1, 3, 7, 30, or "permanent") AND reasonNote; lock/sendToModQueue/approve/contributorAdd/contributorRemove need nothing else.',
  properties: {
    kind: {
      type: 'string',
      enum: [
        'report',
        'flair',
        'lock',
        'sendToModQueue',
        'approve',
        'sticky',
        'distinguish',
        'commentReply',
        'modmailNotify',
        'remove',
        'mute',
        'ban',
        'contributorAdd',
        'contributorRemove',
      ],
    },
    reasonCode: { type: 'string' },
    flairTemplate: { type: 'string' },
    pinSlot: { type: 'integer' },
    how: { type: 'string', enum: ['moderator', 'admin'] },
    templateId: { type: 'string' },
    subjectTemplate: { type: 'string' },
    spam: { type: 'boolean' },
    durationMinutes: { type: 'integer' },
    durationDays: {
      type: 'string',
      description: 'Either a digit-as-string (1, 3, 7, 30) or the literal "permanent".',
    },
    reasonNote: { type: 'string' },
  },
  required: ['kind'],
};

const CLAUSE_ITEM_SCHEMA = {
  type: 'object',
  description: 'One clause: WHEN <condition tree> THEN <verdict> [UNLESS <condition tree>].',
  properties: {
    clauseName: { type: 'string', description: 'Short kebab-case name, 3..60 chars.' },
    comment: { type: 'string', description: 'Optional free-form note, <=280 chars.' },
    when: CONDITION_TREE_SCHEMA,
    unless: CONDITION_TREE_SCHEMA,
    verdict: VERDICT_SCHEMA,
  },
  required: ['clauseName', 'when', 'verdict'],
};

const GEMINI_TOOL_PARAMETERS: Record<'compileRule' | 'clarify', unknown> = {
  compileRule: {
    type: 'object',
    description:
      'A compiled EDICT rule object. You MUST call this function with the structured JSON output — do not respond with prose. See the system prompt for the full clause / combinator / verdict grammar.',
    properties: {
      schemaVersion: {
        type: 'integer',
        description: 'Always 1 for v1.',
      },
      title: { type: 'string', description: '3..80 chars, human-readable.' },
      description: { type: 'string', description: '10..500 chars.' },
      englishSource: {
        type: 'string',
        description: 'The original English the moderator typed; 8..2000 chars.',
      },
      compilerConfidence: {
        type: 'number',
        description: '0..1 — your self-reported confidence in this compile.',
      },
      clauses: {
        type: 'array',
        description:
          'Ordered list of 1..8 WHEN/UNLESS/THEN clauses, evaluated top-to-bottom; first match wins.',
        items: CLAUSE_ITEM_SCHEMA,
      },
      tags: {
        type: 'array',
        description: 'Optional kebab-case tags for gallery categorisation.',
        items: { type: 'string' },
      },
    },
    required: [
      'schemaVersion',
      'title',
      'description',
      'englishSource',
      'clauses',
      'compilerConfidence',
    ],
  },
  clarify: {
    type: 'object',
    description:
      'Use this ONLY when the moderator-supplied sentence is genuinely ambiguous (multiple plausible interpretations). Otherwise call compileRule.',
    properties: {
      question: {
        type: 'string',
        description: 'Single short question, 5..240 chars.',
      },
      options: {
        type: 'array',
        description: '2..4 short option strings the moderator can pick from.',
        items: { type: 'string' },
      },
    },
    required: ['question', 'options'],
  },
};

const geminiTools = (
  toolSpecs: LLMInvocation['tools'],
): { functionDeclarations: { name: string; description: string; parameters: unknown }[] }[] => {
  return [
    {
      functionDeclarations: toolSpecs.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: GEMINI_TOOL_PARAMETERS[t.name],
      })),
    },
  ];
};

const buildContents = (invocation: LLMInvocation): GeminiContent[] => {
  const out: GeminiContent[] = [];
  for (const ex of invocation.exemplars) {
    out.push({ role: 'user', parts: [{ text: ex.user }] });
    out.push({
      role: 'model',
      parts: [
        {
          functionCall: {
            name: ex.toolCallName,
            args: ex.toolCallArguments as unknown,
          },
        },
      ],
    });
  }
  out.push({ role: 'user', parts: [{ text: invocation.userMessage }] });
  return out;
};

export const buildGeminiLLMClient = (
  config: Partial<GeminiConfig> & { apiKey: string },
): LLMPort => {
  const merged: GeminiConfig = { ...DEFAULTS, ...config };
  return {
    invoke: async (invocation: LLMInvocation): Promise<LLMResponse> => {
      const url =
        `${merged.baseUrl}/models/${encodeURIComponent(invocation.model)}:generateContent` +
        `?key=${encodeURIComponent(merged.apiKey)}`;

      const allowedNames = invocation.tools.map((t) => t.name);
      const body = {
        systemInstruction: {
          parts: [
            {
              text:
                `${invocation.systemPrompt}\n\n` +
                'CRITICAL: respond ONLY by calling the compileRule or clarify function. Never reply with prose or markdown — the calling code only consumes the function-call JSON and will reject any text reply.',
            },
          ],
        },
        contents: buildContents(invocation),
        tools: geminiTools(invocation.tools),
        toolConfig: {
          // mode=ANY + an explicit allowedFunctionNames list pins the
          // model to picking exactly one of OUR functions. Without the
          // list, Gemini 2.5 occasionally falls back to a text reply
          // when its shallow parameter schema doesn't give it enough
          // signal to commit to one tool ("Compiler returned prose"
          // is the symptom in our compiler).
          functionCallingConfig: {
            mode: 'ANY' as const,
            allowedFunctionNames: allowedNames,
          },
        },
        generationConfig: {
          temperature: 0,
          maxOutputTokens: maxOutputTokensFor(invocation.reasoningEffort),
          // candidateCount defaults to 1, which is what we want — a
          // deterministic compiler returns one answer.
        },
      };

      const RETRYABLE = new Set([429, 500, 502, 503, 504]);
      const MAX_RETRIES = 3;
      let resp!: Response;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delayMs = merged.retryDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s (or 0 in tests)
          // eslint-disable-next-line no-console
          console.warn(`[edict] Gemini retry ${attempt}/${MAX_RETRIES} after ${delayMs}ms`);
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        }

        const controller = new AbortController();
        const cancel = setTimeout(() => controller.abort(), merged.timeoutMs);
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': merged.userAgent,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (err) {
          clearTimeout(cancel);
          if (attempt < MAX_RETRIES) continue;
          throw new InfrastructureFailure('Gemini request failed (network).', err);
        } finally {
          clearTimeout(cancel);
        }

        if (resp.ok) break;

        if (RETRYABLE.has(resp.status) && attempt < MAX_RETRIES) {
          // eslint-disable-next-line no-console
          console.warn(`[edict] Gemini returned ${resp.status}, will retry...`);
          continue;
        }

        const text = await resp.text().catch(() => '<no body>');
        throw new InfrastructureFailure(
          `Gemini returned ${resp.status} ${resp.statusText}: ${text.slice(0, 240)}`,
        );
      }

      const rawBody = await resp.text();
      let parsed: GeminiResponseBody;
      try {
        parsed = JSON.parse(rawBody) as GeminiResponseBody;
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[edict] Gemini returned non-JSON body:', rawBody.slice(0, 500));
        throw new CompilationFailure(`Gemini returned non-JSON response: ${rawBody.slice(0, 240)}`);
      }
      if (parsed.promptFeedback?.blockReason) {
        // eslint-disable-next-line no-console
        console.warn('[edict] Gemini blocked prompt:', parsed.promptFeedback);
        throw new CompilationFailure(
          `Gemini refused the prompt: ${parsed.promptFeedback.blockReason}`,
        );
      }
      const candidate = parsed.candidates?.[0];

      // --- MALFORMED_FUNCTION_CALL recovery ---
      // Gemini 2.5 sometimes wraps the function call in Python-style
      // `print(default_api.compileRule(...))` syntax, which Gemini's own
      // parser rejects as MALFORMED_FUNCTION_CALL. The finishMessage
      // contains the truncated call text. We retry once without function
      // calling, asking for raw JSON instead.
      if (
        candidate?.finishReason === 'MALFORMED_FUNCTION_CALL' ||
        (!candidate?.content?.parts?.length && candidate?.finishReason)
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `[edict] Gemini MALFORMED_FUNCTION_CALL — retrying with JSON mode. finishReason=${candidate.finishReason}`,
        );

        // Retry: ask Gemini to return raw JSON without function calling
        const retryBody = {
          systemInstruction: {
            parts: [
              {
                text:
                  `${invocation.systemPrompt}\n\n` +
                  'CRITICAL: You MUST respond with a single JSON object only — no markdown fences, no explanation, no prose.\n' +
                  'The JSON must have this top-level shape: { "toolName": "compileRule", "args": { ...rule fields... } }\n' +
                  'OR if the sentence is ambiguous: { "toolName": "clarify", "args": { "question": "...", "options": ["...", "..."] } }\n' +
                  'Do NOT wrap in a function call. Just output the raw JSON object.',
              },
            ],
          },
          contents: buildContents(invocation),
          // No tools, no toolConfig — pure text generation
          generationConfig: {
            temperature: 0,
            maxOutputTokens: maxOutputTokensFor(invocation.reasoningEffort),
            responseMimeType: 'application/json',
          },
        };

        const retryController = new AbortController();
        const retryCancel = setTimeout(() => retryController.abort(), merged.timeoutMs);
        let retryResp: Response;
        try {
          retryResp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': merged.userAgent,
            },
            body: JSON.stringify(retryBody),
            signal: retryController.signal,
          });
        } catch (err) {
          throw new InfrastructureFailure('Gemini retry request failed (network).', err);
        } finally {
          clearTimeout(retryCancel);
        }

        if (!retryResp.ok) {
          const text = await retryResp.text().catch(() => '<no body>');
          throw new InfrastructureFailure(
            `Gemini retry returned ${retryResp.status}: ${text.slice(0, 240)}`,
          );
        }

        const retryRaw = await retryResp.text();
        let retryParsed: GeminiResponseBody;
        try {
          retryParsed = JSON.parse(retryRaw) as GeminiResponseBody;
        } catch {
          throw new CompilationFailure(`Gemini retry returned non-JSON: ${retryRaw.slice(0, 240)}`);
        }

        const retryCandidate = retryParsed.candidates?.[0];
        const retryText =
          retryCandidate?.content?.parts
            ?.filter((p): p is GeminiTextPart => 'text' in p)
            .map((p) => p.text)
            .join('') ?? '';

        if (!retryText.trim()) {
          throw new CompilationFailure('Gemini retry returned empty text.');
        }

        // Parse the JSON envelope: { "toolName": "compileRule", "args": {...} }
        let envelope: { toolName?: string; args?: unknown };
        try {
          envelope = JSON.parse(retryText) as { toolName?: string; args?: unknown };
        } catch {
          // Maybe it returned the args directly without the envelope
          try {
            const directArgs = JSON.parse(retryText) as Record<string, unknown>;
            if (directArgs['schemaVersion'] || directArgs['clauses']) {
              return {
                kind: 'toolCall',
                toolName: 'compileRule',
                argumentsJson: retryText,
              };
            }
            if (directArgs['question'] && directArgs['options']) {
              return {
                kind: 'toolCall',
                toolName: 'clarify',
                argumentsJson: retryText,
              };
            }
          } catch {
            /* fall through */
          }
          throw new CompilationFailure(
            `Gemini retry returned unparseable JSON: ${retryText.slice(0, 240)}`,
          );
        }

        const toolName = envelope.toolName;
        if (toolName === 'compileRule' || toolName === 'clarify') {
          return {
            kind: 'toolCall',
            toolName,
            argumentsJson: JSON.stringify(envelope.args ?? {}),
          };
        }
        // If the envelope IS the rule itself (no wrapper)
        if (
          (envelope as Record<string, unknown>)['schemaVersion'] ||
          (envelope as Record<string, unknown>)['clauses']
        ) {
          return {
            kind: 'toolCall',
            toolName: 'compileRule',
            argumentsJson: JSON.stringify(envelope),
          };
        }

        throw new CompilationFailure(
          `Gemini retry returned unexpected shape: ${retryText.slice(0, 240)}`,
        );
      }

      if (!candidate?.content?.parts?.length) {
        // eslint-disable-next-line no-console
        console.warn('[edict] Gemini returned no candidate content:', rawBody.slice(0, 800));
        throw new CompilationFailure(
          `Gemini returned no candidate content. Finish reason: ${candidate?.finishReason ?? '<none>'}. Raw: ${rawBody.slice(0, 240)}`,
        );
      }

      const fnCall = candidate.content.parts.find(
        (p): p is GeminiFunctionCallPart => 'functionCall' in p,
      );
      if (fnCall) {
        if (fnCall.functionCall.name !== 'compileRule' && fnCall.functionCall.name !== 'clarify') {
          throw new CompilationFailure(
            `Unexpected tool name from Gemini: ${fnCall.functionCall.name}`,
          );
        }
        return {
          kind: 'toolCall',
          toolName: fnCall.functionCall.name,
          argumentsJson: JSON.stringify(fnCall.functionCall.args ?? {}),
        };
      }

      const textPart = candidate.content.parts.find((p): p is GeminiTextPart => 'text' in p);
      const prose = textPart?.text ?? '';
      // eslint-disable-next-line no-console
      console.warn(
        '[edict] Gemini returned prose instead of functionCall.',
        '\n  model:',
        invocation.model,
        '\n  finishReason:',
        candidate.finishReason,
        '\n  prose (first 800 chars):',
        prose.slice(0, 800),
        '\n  full response (first 1200 chars):',
        rawBody.slice(0, 1200),
      );
      return { kind: 'rawText', text: prose };
    },
  };
};

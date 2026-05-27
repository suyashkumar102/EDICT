import type { CompiledRule } from '@compilation/schema/RuleSchema';
import { compiledRuleSchema, formatIssues } from '@compilation/schema/RuleSchema';
import { ruleJsonSchema } from '@compilation/schema/JsonSchemaExport';
import { COMPILER_SYSTEM_PROMPT } from '@compilation/prompts/CompilerSystemPrompt';
import { EXEMPLARS } from '@compilation/prompts/CompilerExemplars';
import {
  AmbiguousSentenceError,
  CompilationFailure,
  SchemaValidationFailure,
} from '@shared/errors/DomainError';
import type { ActionKind } from '@domain/values/ActionVerdict';
import { decideWhitelist } from '@domain/policies/ActionWhitelistPolicy';
import type { ConfidenceScore } from '@domain/values/ConfidenceScore';
import { buildConfidence } from '@domain/values/ConfidenceScore';

/**
 * CompilerService is the single entry point for English → compiled rule.
 *
 * Architectural choices:
 *  - The LLM client is injected (LLMPort) so the domain has zero knowledge
 *    of OpenAI. Tests pass a fake. Production passes OpenAiLLMClient.
 *  - We use OpenAI's *function-calling* (tool-call) mode, not raw chat.
 *    That gives us schema-constrained sampling at the API boundary, in
 *    addition to our own Zod parse afterwards.
 *  - We re-validate against `compiledRuleSchema` even on a successful
 *    structured-output call. The model can satisfy JSON Schema while
 *    failing our deeper invariants (atom-id uniqueness, clause name
 *    length, etc.). Belt + braces.
 *  - We re-check the whitelist policy after schema validation. Risky
 *    verdicts on opt-out are rejected at compile time, never at runtime.
 */

export interface LLMPort {
  invoke(input: LLMInvocation): Promise<LLMResponse>;
}

export interface LLMInvocation {
  readonly model: string;
  readonly systemPrompt: string;
  readonly exemplars: typeof EXEMPLARS;
  readonly userMessage: string;
  readonly tools: readonly LLMToolSpec[];
  readonly reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  readonly verbosity: 'low' | 'medium' | 'high';
}

export interface LLMToolSpec {
  readonly name: 'compileRule' | 'clarify';
  readonly description: string;
  readonly parameters: unknown;
}

export type LLMResponse =
  | { kind: 'toolCall'; toolName: 'compileRule'; argumentsJson: string }
  | { kind: 'toolCall'; toolName: 'clarify'; argumentsJson: string }
  | { kind: 'rawText'; text: string };

export interface CompileRequest {
  readonly englishSource: string;
  readonly title: string;
  readonly description: string;
  readonly optInActions: ReadonlySet<ActionKind>;
  readonly priorClarifications: readonly { question: string; answer: string }[];
  readonly model: string;
  readonly verbosity: 'strict' | 'balanced' | 'permissive';
}

export interface CompileResult {
  readonly rule: CompiledRule;
  readonly confidence: ConfidenceScore;
  readonly diffSummary: string;
  readonly fingerprint: string;
}

const TOOL_SPECS: readonly LLMToolSpec[] = [
  {
    name: 'compileRule',
    description: "Emit a structured EDICT rule for the moderator's sentence.",
    parameters: ruleJsonSchema,
  },
  {
    name: 'clarify',
    description: 'Ask the moderator a clarifying question when the sentence is ambiguous.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'options'],
      properties: {
        question: { type: 'string', minLength: 5, maxLength: 240 },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string', minLength: 3, maxLength: 200 },
        },
      },
    },
  },
];

const reasoningEffortFor = (
  verbosity: CompileRequest['verbosity'],
): LLMInvocation['reasoningEffort'] => {
  switch (verbosity) {
    case 'strict':
      return 'medium';
    case 'balanced':
      return 'low';
    case 'permissive':
      return 'none';
  }
};

const interpolateClarifications = (
  english: string,
  clarifications: readonly { question: string; answer: string }[],
): string => {
  if (clarifications.length === 0) return english;
  const trail = clarifications
    .map((c, i) => `(clarification ${i + 1}) Q: ${c.question}\nA: ${c.answer}`)
    .join('\n');
  return `${english}\n\n— clarifications captured —\n${trail}`;
};

const computeFingerprint = (rule: CompiledRule): string => {
  // Cheap-but-stable structural fingerprint. Two rules with the same atom
  // facts and comparators (regardless of atomId & clauseName) hash to the
  // same value. This is what the ConflictDetector uses to find duplicates.
  const stripped = JSON.stringify({
    schemaVersion: rule.schemaVersion,
    clauses: rule.clauses.map((c) => ({
      when: stripIds(c.when),
      unless: c.unless ? stripIds(c.unless) : undefined,
      verdict: c.verdict,
    })),
  });
  // Simple 32-bit hash, deterministic, no deps.
  let h = 5381;
  for (let i = 0; i < stripped.length; i += 1) {
    h = ((h << 5) + h) ^ stripped.charCodeAt(i);
  }
  return ((h >>> 0) >>> 0).toString(16).padStart(8, '0');
};

const stripIds = (tree: unknown): unknown => {
  if (typeof tree !== 'object' || tree === null) return tree;
  const node = tree as Record<string, unknown>;
  if (node['kind'] === 'atom') {
    const { atomId: _atomId, ...rest } = node as { atomId: string };
    return rest;
  }
  if (node['kind'] === 'and' || node['kind'] === 'or') {
    return { ...node, children: (node['children'] as unknown[]).map(stripIds) };
  }
  if (node['kind'] === 'not') {
    return { ...node, child: stripIds(node['child']) };
  }
  return node;
};

const summariseDiff = (rule: CompiledRule): string => {
  const verdictTypes = new Set(rule.clauses.map((c) => c.verdict.kind));
  return `${rule.clauses.length} clause(s); verdicts: ${[...verdictTypes].join(', ')}`;
};

export const buildCompilerService = (llm: LLMPort) => ({
  compile: async (req: CompileRequest): Promise<CompileResult> => {
    const userMessage = interpolateClarifications(req.englishSource, req.priorClarifications);

    const response = await llm.invoke({
      model: req.model,
      systemPrompt: COMPILER_SYSTEM_PROMPT,
      exemplars: EXEMPLARS,
      userMessage,
      tools: TOOL_SPECS,
      reasoningEffort: reasoningEffortFor(req.verbosity),
      verbosity: 'low',
    });

    if (response.kind === 'rawText') {
      const prose = response.text.slice(0, 280);
      // eslint-disable-next-line no-console
      console.warn(
        '[edict] CompilerService received prose response (length=' + response.text.length + '):',
        prose,
      );
      throw new CompilationFailure(
        // Surface the actual prose in the message so the Reddit toast
        // shows it. The fragment field is also kept for callers that
        // want it structured.
        `Compiler returned prose: ${prose || '<empty>'}`,
        prose,
      );
    }

    if (response.toolName === 'clarify') {
      const parsed = JSON.parse(response.argumentsJson) as {
        question: string;
        options: string[];
      };
      throw new AmbiguousSentenceError(parsed.question, parsed.options);
    }

    // tool === compileRule
    let raw: unknown;
    try {
      raw = JSON.parse(response.argumentsJson);
    } catch (err) {
      throw new CompilationFailure(
        'Compiler returned malformed JSON in the compileRule tool call.',
        response.argumentsJson.slice(0, 240),
        err,
      );
    }

    const parsed = compiledRuleSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = formatIssues(parsed);
      // eslint-disable-next-line no-console
      console.warn(
        '[edict] schema validation failed. issues=',
        issues,
        '\n  raw (first 1500 chars):',
        JSON.stringify(raw).slice(0, 1500),
      );
      // Include the top 3 issues in the thrown message so the Reddit
      // toast shows what Gemini got wrong, not just "validation failed".
      const summary = issues.slice(0, 3).join(' | ');
      throw new SchemaValidationFailure(
        `Compiled rule failed schema validation: ${summary}`,
        issues,
      );
    }

    const rule = parsed.data;

    // whitelist gate
    for (const clause of rule.clauses) {
      const decision = decideWhitelist(clause.verdict.kind, req.optInActions);
      if (!decision.permitted) {
        throw new SchemaValidationFailure(
          `Clause "${clause.clauseName}" uses verdict "${clause.verdict.kind}" which requires explicit opt-in.`,
          [`reason: ${decision.reason}`],
        );
      }
    }

    // atom-id uniqueness sweep (Zod can't express this neatly across the tree)
    const seenIds = new Set<string>();
    const checkTree = (n: unknown): void => {
      if (typeof n !== 'object' || n === null) return;
      const node = n as Record<string, unknown>;
      if (node['kind'] === 'atom') {
        const id = String(node['atomId']);
        if (seenIds.has(id)) {
          throw new SchemaValidationFailure(`Duplicate atomId across clauses: ${id}`, []);
        }
        seenIds.add(id);
      } else if (node['kind'] === 'and' || node['kind'] === 'or') {
        (node['children'] as unknown[]).forEach(checkTree);
      } else if (node['kind'] === 'not') {
        checkTree(node['child']);
      }
    };
    for (const clause of rule.clauses) {
      checkTree(clause.when);
      if (clause.unless) checkTree(clause.unless);
    }

    return {
      rule,
      confidence: buildConfidence(rule.compilerConfidence),
      diffSummary: summariseDiff(rule),
      fingerprint: computeFingerprint(rule),
    };
  },
});

export type CompilerService = ReturnType<typeof buildCompilerService>;

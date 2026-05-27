import type { LLMInvocation, LLMPort, LLMResponse } from '@compilation/llm/CompilerService';
import { CompilationFailure, InfrastructureFailure } from '@shared/errors/DomainError';

/**
 * Thin OpenAI client. Lives in `compilation/llm` rather than
 * `infrastructure/llmclient` because the compiler is the ONLY place that
 * talks to the model — there's no need for a separate adapter layer
 * abstracting between multiple compiler call-sites.
 *
 * Notes:
 *  - We pin to the Responses API with strict structured outputs
 *    (response_format.type='json_schema' equivalent on the tool side).
 *  - We send the system prompt as the first message, then each exemplar
 *    as a (user, assistant-tool-call) pair, then the live user message.
 *  - Temperature is fixed at 0. The compiler must be deterministic for
 *    cached re-compiles to be idempotent.
 *  - Timeout: 30 s. The compiler is interactive — anything longer is
 *    a worse UX than just failing fast.
 */

export interface OpenAiConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly userAgent: string;
}

const DEFAULTS: Omit<OpenAiConfig, 'apiKey'> = {
  baseUrl: 'https://api.openai.com/v1',
  timeoutMs: 30_000,
  userAgent: 'edict/1.0',
};

interface OpenAiChoice {
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: {
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }[];
  };
}

interface OpenAiResponseBody {
  choices: OpenAiChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export const buildOpenAiLLMClient = (
  config: Partial<OpenAiConfig> & { apiKey: string },
): LLMPort => {
  const merged: OpenAiConfig = { ...DEFAULTS, ...config };
  return {
    invoke: async (invocation: LLMInvocation): Promise<LLMResponse> => {
      const messages: {
        role: 'system' | 'user' | 'assistant';
        content: string | null;
        tool_calls?: unknown[];
      }[] = [{ role: 'system', content: invocation.systemPrompt }];
      for (const ex of invocation.exemplars) {
        messages.push({ role: 'user', content: ex.user });
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `ex-${ex.toolCallName}`,
              type: 'function',
              function: {
                name: ex.toolCallName,
                arguments: JSON.stringify(ex.toolCallArguments),
              },
            },
          ],
        });
      }
      messages.push({ role: 'user', content: invocation.userMessage });

      const body = {
        model: invocation.model,
        messages,
        temperature: 0,
        max_completion_tokens: 1500,
        tools: invocation.tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            strict: true,
          },
        })),
        tool_choice: 'required' as const,
        reasoning_effort: invocation.reasoningEffort,
      };

      const controller = new AbortController();
      const cancel = setTimeout(() => controller.abort(), merged.timeoutMs);
      let resp: Response;
      try {
        resp = await fetch(`${merged.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${merged.apiKey}`,
            'User-Agent': merged.userAgent,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        throw new InfrastructureFailure('OpenAI request failed (network).', err);
      } finally {
        clearTimeout(cancel);
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => '<no body>');
        throw new InfrastructureFailure(
          `OpenAI returned ${resp.status} ${resp.statusText}: ${text.slice(0, 240)}`,
        );
      }

      const parsed = (await resp.json()) as OpenAiResponseBody;
      const first = parsed.choices[0];
      if (!first) {
        throw new CompilationFailure('OpenAI returned no choices.');
      }
      const call = first.message.tool_calls?.[0];
      if (call) {
        if (call.function.name !== 'compileRule' && call.function.name !== 'clarify') {
          throw new CompilationFailure(`Unexpected tool name: ${call.function.name}`);
        }
        return {
          kind: 'toolCall',
          toolName: call.function.name,
          argumentsJson: call.function.arguments,
        };
      }
      return { kind: 'rawText', text: first.message.content ?? '' };
    },
  };
};

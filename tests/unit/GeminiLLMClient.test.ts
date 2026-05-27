import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGeminiLLMClient } from '@compilation/llm/GeminiLLMClient';
import type { LLMInvocation } from '@compilation/llm/CompilerService';
import { InfrastructureFailure, CompilationFailure } from '@shared/errors/DomainError';

/**
 * Tests for GeminiLLMClient. The client is a pure-fetch wrapper, so we
 * mock global.fetch and inspect:
 *   - URL contains the right model and the API key as `?key=`
 *   - body has systemInstruction, contents, tools.functionDeclarations
 *   - toolConfig.functionCallingConfig.mode = 'ANY' (force function call)
 *   - response decoding picks the right path on functionCall vs text
 *   - error paths (non-2xx, prompt-blocked) translate to typed exceptions
 */

const invocation: LLMInvocation = {
  model: 'gemini-2.5-flash',
  systemPrompt: 'You compile English rules into EDICT JSON.',
  exemplars: [
    {
      user: 'Lock all-caps titles.',
      toolCallName: 'compileRule',
      toolCallArguments: { schemaVersion: 1 },
    },
  ],
  userMessage: 'Lock posts whose title is in all caps.',
  tools: [
    { name: 'compileRule', description: 'compile', parameters: { type: 'object' } },
    { name: 'clarify', description: 'ask', parameters: { type: 'object' } },
  ],
  reasoningEffort: 'low',
  verbosity: 'low',
};

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = global.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

const respond = (body: unknown, init: { status?: number; statusText?: string } = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'Content-Type': 'application/json' },
  });

describe('GeminiLLMClient request shape', () => {
  it('targets the right URL and embeds the API key as ?key=', async () => {
    fetchMock.mockResolvedValue(
      respond({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'compileRule', args: { schemaVersion: 1 } } }],
            },
          },
        ],
      }),
    );
    const client = buildGeminiLLMClient({ apiKey: 'AIza-test-key' });
    await client.invoke(invocation);

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(String(url)).toContain('key=AIza-test-key');
  });

  it('sends systemInstruction, contents, tools, toolConfig, generationConfig', async () => {
    fetchMock.mockResolvedValue(
      respond({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'compileRule', args: {} } }],
            },
          },
        ],
      }),
    );
    const client = buildGeminiLLMClient({ apiKey: 'k' });
    await client.invoke(invocation);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.systemInstruction).toBeTruthy();
    expect(Array.isArray(body.contents)).toBe(true);
    expect((body.contents as unknown[]).length).toBeGreaterThan(0);
    const tools = body.tools as { functionDeclarations: { name: string }[] }[];
    expect(tools[0]!.functionDeclarations.map((d) => d.name)).toEqual(['compileRule', 'clarify']);
    expect(
      (body.toolConfig as { functionCallingConfig: { mode: string } }).functionCallingConfig.mode,
    ).toBe('ANY');
    expect((body.generationConfig as { temperature: number }).temperature).toBe(0);
  });

  it('translates a functionCall response into a toolCall LLMResponse', async () => {
    fetchMock.mockResolvedValue(
      respond({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'compileRule',
                    args: { schemaVersion: 1, title: 'Lock caps' },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    const client = buildGeminiLLMClient({ apiKey: 'k' });
    const resp = await client.invoke(invocation);
    expect(resp.kind).toBe('toolCall');
    if (resp.kind === 'toolCall') {
      expect(resp.toolName).toBe('compileRule');
      const parsed = JSON.parse(resp.argumentsJson) as { schemaVersion: number };
      expect(parsed.schemaVersion).toBe(1);
    }
  });

  it('translates a text-only response into a rawText LLMResponse', async () => {
    fetchMock.mockResolvedValue(
      respond({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'I cannot compile this rule.' }] } },
        ],
      }),
    );
    const client = buildGeminiLLMClient({ apiKey: 'k' });
    const resp = await client.invoke(invocation);
    expect(resp.kind).toBe('rawText');
    if (resp.kind === 'rawText') {
      expect(resp.text).toContain('cannot compile');
    }
  });
});

describe('GeminiLLMClient error paths', () => {
  it('throws InfrastructureFailure on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      respond(
        { error: { message: 'rate limit' } },
        { status: 429, statusText: 'Too Many Requests' },
      ),
    );
    // Pass retryDelayMs:0 so the retry loop completes instantly without real timers
    const client = buildGeminiLLMClient({ apiKey: 'k', retryDelayMs: 0 });
    await expect(client.invoke(invocation)).rejects.toBeInstanceOf(InfrastructureFailure);
  });

  it('throws CompilationFailure when prompt is blocked', async () => {
    fetchMock.mockResolvedValue(
      respond({
        promptFeedback: { blockReason: 'SAFETY' },
      }),
    );
    const client = buildGeminiLLMClient({ apiKey: 'k' });
    await expect(client.invoke(invocation)).rejects.toBeInstanceOf(CompilationFailure);
  });

  it('throws CompilationFailure when no candidates are returned', async () => {
    fetchMock.mockResolvedValue(respond({ candidates: [] }));
    const client = buildGeminiLLMClient({ apiKey: 'k' });
    await expect(client.invoke(invocation)).rejects.toBeInstanceOf(CompilationFailure);
  });

  it('throws CompilationFailure on an unexpected tool name', async () => {
    fetchMock.mockResolvedValue(
      respond({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'someOtherTool', args: {} } }],
            },
          },
        ],
      }),
    );
    const client = buildGeminiLLMClient({ apiKey: 'k' });
    await expect(client.invoke(invocation)).rejects.toBeInstanceOf(CompilationFailure);
  });

  it('throws InfrastructureFailure when fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    // Pass retryDelayMs:0 so the retry loop completes instantly without real timers
    const client = buildGeminiLLMClient({ apiKey: 'k', retryDelayMs: 0 });
    await expect(client.invoke(invocation)).rejects.toBeInstanceOf(InfrastructureFailure);
  });
});

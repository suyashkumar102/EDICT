import type {
  CompilerService,
  CompileRequest,
  CompileResult,
} from '@compilation/llm/CompilerService';
import { AmbiguousSentenceError } from '@shared/errors/DomainError';

/**
 * The compiler may emit `clarify` instead of `compileRule`. The Compose Rule
 * UI displays the question with the suggested options. The mod picks one
 * (or types a free-text answer). We pass the original English + the
 * Q/A pair back through the compiler.
 *
 * Cap: 3 rounds of clarification per draft. If we still can't compile,
 * we surface the chain of questions to the mod so they can rewrite the
 * sentence from scratch — silent looping would feel like a hang.
 */

export interface ClarificationTurn {
  readonly question: string;
  readonly answer: string;
}

export interface ResolveResult {
  readonly outcome: 'compiled';
  readonly result: CompileResult;
  readonly clarifications: readonly ClarificationTurn[];
}

export interface ClarifyOutstanding {
  readonly outcome: 'clarify';
  readonly question: string;
  readonly options: readonly string[];
  readonly clarifications: readonly ClarificationTurn[];
  readonly continueWith: (answer: string) => Promise<ResolveResult | ClarifyOutstanding | TimedOut>;
}

export interface TimedOut {
  readonly outcome: 'timed-out';
  readonly clarifications: readonly ClarificationTurn[];
  readonly lastQuestion: string;
}

const MAX_ROUNDS = 3;

export const resolveCompilation = async (
  compiler: CompilerService,
  base: CompileRequest,
  rounds = 0,
): Promise<ResolveResult | ClarifyOutstanding | TimedOut> => {
  try {
    const result = await compiler.compile(base);
    return {
      outcome: 'compiled',
      result,
      clarifications: base.priorClarifications.slice(),
    };
  } catch (err) {
    if (err instanceof AmbiguousSentenceError) {
      if (rounds >= MAX_ROUNDS) {
        return {
          outcome: 'timed-out',
          clarifications: base.priorClarifications.slice(),
          lastQuestion: err.clarifyingQuestion,
        };
      }
      const continueWith = async (answer: string) => {
        const next: CompileRequest = {
          ...base,
          priorClarifications: [
            ...base.priorClarifications,
            { question: err.clarifyingQuestion, answer },
          ],
        };
        return resolveCompilation(compiler, next, rounds + 1);
      };
      return {
        outcome: 'clarify',
        question: err.clarifyingQuestion,
        options: err.suggestedOptions,
        clarifications: base.priorClarifications.slice(),
        continueWith,
      };
    }
    throw err;
  }
};

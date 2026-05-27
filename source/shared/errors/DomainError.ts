/**
 * Discriminated error hierarchy. We use classes instead of `throw new Error(...)`
 * because Hono handlers branch on `instanceof` to decide HTTP status codes, and
 * the orchestration layer's saga compensations branch on error kind too.
 *
 * Adding a new error: create a class extending DomainError with a unique `kind`.
 */

export abstract class DomainError extends Error {
  public abstract readonly kind: string;
  public readonly cause: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

export class CompilationFailure extends DomainError {
  public readonly kind = 'CompilationFailure' as const;
  public constructor(
    message: string,
    public readonly fragment?: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class AmbiguousSentenceError extends DomainError {
  public readonly kind = 'AmbiguousSentenceError' as const;
  public constructor(
    public readonly clarifyingQuestion: string,
    public readonly suggestedOptions: readonly string[],
  ) {
    super(`Compiler needs clarification: ${clarifyingQuestion}`);
  }
}

export class SchemaValidationFailure extends DomainError {
  public readonly kind = 'SchemaValidationFailure' as const;
  public constructor(
    message: string,
    public readonly issues: readonly string[],
  ) {
    super(message);
  }
}

export class RuleNotFound extends DomainError {
  public readonly kind = 'RuleNotFound' as const;
  public constructor(public readonly ruleId: string) {
    super(`Rule not found: ${ruleId}`);
  }
}

export class RuleStateConflict extends DomainError {
  public readonly kind = 'RuleStateConflict' as const;
  public constructor(message: string) {
    super(message);
  }
}

export class CircuitBreakerOpen extends DomainError {
  public readonly kind = 'CircuitBreakerOpen' as const;
  public constructor(
    public readonly scope: 'rule' | 'subreddit',
    public readonly until: number,
  ) {
    super(`Circuit breaker (${scope}) is open until ${new Date(until).toISOString()}`);
  }
}

export class ConsensusRequired extends DomainError {
  public readonly kind = 'ConsensusRequired' as const;
  public constructor(
    public readonly needed: number,
    public readonly current: number,
  ) {
    super(`Consensus required: ${current}/${needed} approvals so far`);
  }
}

export class UnauthorizedActor extends DomainError {
  public readonly kind = 'UnauthorizedActor' as const;
  public constructor(message: string) {
    super(message);
  }
}

export class RollbackWindowExpired extends DomainError {
  public readonly kind = 'RollbackWindowExpired' as const;
  public constructor(
    public readonly actionId: string,
    public readonly expiredAt: number,
  ) {
    super(`Rollback window expired at ${new Date(expiredAt).toISOString()} for action ${actionId}`);
  }
}

export class QuotaExceeded extends DomainError {
  public readonly kind = 'QuotaExceeded' as const;
  public constructor(
    public readonly resource: string,
    public readonly window: string,
  ) {
    super(`Quota exceeded for ${resource} (${window})`);
  }
}

export class InfrastructureFailure extends DomainError {
  public readonly kind = 'InfrastructureFailure' as const;
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

export class RetryError extends Error {
  readonly lastError: unknown;
  readonly attempts: number;
  readonly modelsAttempted: string[];

  constructor(lastError: unknown, attempts: number, modelsAttempted: string[]) {
    const models = modelsAttempted.length
      ? ` across models: ${modelsAttempted.join(', ')}`
      : '';
    super(`All ${attempts} retry attempts failed${models}`);
    this.name = 'RetryError';
    this.lastError = lastError;
    this.attempts = attempts;
    this.modelsAttempted = modelsAttempted;
  }
}

export class BudgetExceededError extends Error {
  readonly tokensUsed: number;
  readonly budget: number;

  constructor(tokensUsed: number, budget: number) {
    super(`Token budget exceeded: ${tokensUsed} used, ${budget} limit`);
    this.name = 'BudgetExceededError';
    this.tokensUsed = tokensUsed;
    this.budget = budget;
  }
}

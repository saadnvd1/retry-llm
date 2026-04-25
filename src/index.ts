export { classifyError, type ErrorClass } from './classify.js';
export { getRetryAfter } from './retry-after.js';
export { RetryError, BudgetExceededError } from './errors.js';
export type { AiRetryOptions, RetryContext } from './types.js';

import type { AiRetryOptions, RetryContext } from './types.js';
import { classifyError, isRetryable } from './classify.js';
import { getRetryAfter } from './retry-after.js';
import { RetryError, BudgetExceededError } from './errors.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function computeDelay(attempt: number, baseDelay: number, maxDelay: number, jitter: boolean): number {
  const exponential = baseDelay * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelay);
  if (!jitter) return capped;
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

function extractTokens(result: unknown): number {
  const usage = (result as any)?.usage;
  if (!usage) return 0;
  return (usage.input_tokens ?? usage.prompt_tokens ?? 0)
    + (usage.output_tokens ?? usage.completion_tokens ?? 0);
}

export async function retryLlm<T>(
  fn: (ctx: RetryContext) => Promise<T>,
  options?: AiRetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const fallbackModels = options?.fallbackModels ?? [];
  const onRateLimit = options?.onRateLimit ?? 'wait';
  const baseDelay = options?.baseDelay ?? 500;
  const maxDelay = options?.maxDelay ?? 30_000;
  const jitter = options?.jitter ?? true;
  const signal = options?.signal;
  const shouldRetry = options?.shouldRetry;
  const onRetry = options?.onRetry;
  const budgetMaxTokens = options?.budget?.maxTokens;

  const models = [null, ...fallbackModels];
  const modelsAttempted: string[] = [];
  let totalAttempts = 0;
  let tokensUsed = 0;
  let lastError: unknown;

  for (const model of models) {
    if (model !== null) modelsAttempted.push(model);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new RetryError(
          signal.reason ?? new Error('Aborted'),
          totalAttempts,
          modelsAttempted,
        );
      }

      totalAttempts++;

      const ctx: RetryContext = {
        attempt: attempt + 1,
        model,
        totalAttempts,
        tokensUsed,
      };

      try {
        const result = await fn(ctx);

        if (budgetMaxTokens) {
          tokensUsed += extractTokens(result);
          if (tokensUsed > budgetMaxTokens) {
            throw new BudgetExceededError(tokensUsed, budgetMaxTokens);
          }
        }

        return result;
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;

        lastError = error;
        const errorClass = classifyError(error);

        if (!isRetryable(errorClass)) throw error;

        if (shouldRetry) {
          const allow = await shouldRetry(error);
          if (!allow) throw error;
        }

        if (errorClass === 'rate_limit' || errorClass === 'overloaded') {
          if (onRateLimit === 'throw') throw error;
          if (onRateLimit === 'fallback') break; // skip to next model
        }

        if (attempt < maxRetries) {
          onRetry?.(error, ctx);

          let delay: number;
          if ((errorClass === 'rate_limit' || errorClass === 'overloaded') && onRateLimit === 'wait') {
            delay = getRetryAfter(error) ?? computeDelay(attempt, baseDelay, maxDelay, jitter);
          } else {
            delay = computeDelay(attempt, baseDelay, maxDelay, jitter);
          }

          await sleep(delay);
        }
      }
    }
  }

  throw new RetryError(lastError, totalAttempts, modelsAttempted);
}

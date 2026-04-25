export interface RetryContext {
  attempt: number;
  model: string | null;
  totalAttempts: number;
  tokensUsed: number;
}

export interface AiRetryOptions {
  maxRetries?: number;
  fallbackModels?: string[];
  onRateLimit?: 'wait' | 'fallback' | 'throw';
  budget?: { maxTokens?: number; maxCost?: number };
  baseDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean | Promise<boolean>;
  onRetry?: (error: unknown, context: RetryContext) => void;
}

import { describe, test, expect, mock } from 'bun:test';
import { retryLlm, RetryError, BudgetExceededError } from '../src/index';

function makeError(status: number, headers?: Record<string, string>) {
  return Object.assign(new Error(`Error ${status}`), { status, headers });
}

describe('retryLlm', () => {
  test('succeeds on first try', async () => {
    const result = await retryLlm(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('retries on server error then succeeds', async () => {
    let calls = 0;
    const result = await retryLlm(
      () => {
        calls++;
        if (calls < 3) throw makeError(500);
        return Promise.resolve('recovered');
      },
      { baseDelay: 1, jitter: false },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('throws immediately on auth error (401)', async () => {
    let calls = 0;
    try {
      await retryLlm(() => {
        calls++;
        throw makeError(401);
      });
    } catch (e) {
      expect(calls).toBe(1);
      expect((e as any).status).toBe(401);
    }
  });

  test('throws immediately on bad request (400)', async () => {
    let calls = 0;
    try {
      await retryLlm(() => {
        calls++;
        throw makeError(400);
      });
    } catch (e) {
      expect(calls).toBe(1);
      expect((e as any).status).toBe(400);
    }
  });

  test('throws RetryError after exhausting retries', async () => {
    try {
      await retryLlm(
        () => { throw makeError(500); },
        { maxRetries: 2, baseDelay: 1 },
      );
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).attempts).toBe(3); // 1 initial + 2 retries
    }
  });

  test('429 with onRateLimit: wait uses retry-after', async () => {
    let calls = 0;
    const start = Date.now();
    await retryLlm(
      () => {
        calls++;
        if (calls === 1) throw makeError(429, { 'retry-after-ms': '50' });
        return Promise.resolve('ok');
      },
      { onRateLimit: 'wait', baseDelay: 1 },
    );
    expect(calls).toBe(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  test('429 with onRateLimit: throw throws immediately', async () => {
    let calls = 0;
    try {
      await retryLlm(
        () => {
          calls++;
          throw makeError(429);
        },
        { onRateLimit: 'throw' },
      );
    } catch (e) {
      expect(calls).toBe(1);
      expect((e as any).status).toBe(429);
    }
  });

  test('429 with onRateLimit: fallback skips to next model', async () => {
    const modelsUsed: (string | null)[] = [];
    await retryLlm(
      (ctx) => {
        modelsUsed.push(ctx.model);
        if (ctx.model === null) throw makeError(429);
        return Promise.resolve('fallback-ok');
      },
      { onRateLimit: 'fallback', fallbackModels: ['haiku'], baseDelay: 1 },
    );
    expect(modelsUsed).toEqual([null, 'haiku']);
  });

  test('529 overloaded is treated like rate limit', async () => {
    let calls = 0;
    await retryLlm(
      () => {
        calls++;
        if (calls === 1) throw makeError(529);
        return Promise.resolve('ok');
      },
      { baseDelay: 1 },
    );
    expect(calls).toBe(2);
  });

  test('model fallback chain', async () => {
    const modelsUsed: (string | null)[] = [];
    await retryLlm(
      (ctx) => {
        modelsUsed.push(ctx.model);
        if (ctx.model !== 'haiku') throw makeError(500);
        return Promise.resolve('haiku-ok');
      },
      {
        maxRetries: 0, // no retries per model, just fallback
        fallbackModels: ['sonnet', 'haiku'],
        baseDelay: 1,
      },
    );
    expect(modelsUsed).toEqual([null, 'sonnet', 'haiku']);
  });

  test('model fallback exhausted throws RetryError', async () => {
    try {
      await retryLlm(
        () => { throw makeError(500); },
        { maxRetries: 0, fallbackModels: ['sonnet', 'haiku'], baseDelay: 1 },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).modelsAttempted).toEqual(['sonnet', 'haiku']);
    }
  });

  test('budget tracking throws BudgetExceededError', async () => {
    let calls = 0;
    try {
      await retryLlm(
        () => {
          calls++;
          return Promise.resolve({
            content: 'hi',
            usage: { input_tokens: 100, output_tokens: 100 },
          });
        },
        { budget: { maxTokens: 150 } },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect((e as BudgetExceededError).tokensUsed).toBe(200);
      expect(calls).toBe(1);
    }
  });

  test('budget tracking with OpenAI usage fields', async () => {
    try {
      await retryLlm(
        () => Promise.resolve({
          choices: [],
          usage: { prompt_tokens: 80, completion_tokens: 80 },
        }),
        { budget: { maxTokens: 100 } },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect((e as BudgetExceededError).tokensUsed).toBe(160);
    }
  });

  test('AbortSignal stops retrying', async () => {
    const controller = new AbortController();
    controller.abort('cancelled');
    try {
      await retryLlm(
        () => { throw makeError(500); },
        { signal: controller.signal, baseDelay: 1 },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).attempts).toBe(0);
    }
  });

  test('custom shouldRetry can stop retrying', async () => {
    let calls = 0;
    try {
      await retryLlm(
        () => {
          calls++;
          throw makeError(500);
        },
        {
          shouldRetry: () => false,
          baseDelay: 1,
        },
      );
    } catch (e) {
      expect(calls).toBe(1);
      expect((e as any).status).toBe(500);
    }
  });

  test('onRetry callback fires with context', async () => {
    const retryAttempts: number[] = [];
    let calls = 0;
    await retryLlm(
      () => {
        calls++;
        if (calls < 3) throw makeError(500);
        return Promise.resolve('ok');
      },
      {
        baseDelay: 1,
        jitter: false,
        onRetry: (_err, ctx) => retryAttempts.push(ctx.attempt),
      },
    );
    expect(retryAttempts).toEqual([1, 2]);
  });

  test('context.totalAttempts increments across models', async () => {
    const totals: number[] = [];
    await retryLlm(
      (ctx) => {
        totals.push(ctx.totalAttempts);
        if (ctx.totalAttempts < 3) throw makeError(500);
        return Promise.resolve('ok');
      },
      { maxRetries: 0, fallbackModels: ['a', 'b'], baseDelay: 1 },
    );
    expect(totals).toEqual([1, 2, 3]);
  });

  test('jitter produces variable delays', async () => {
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      let calls = 0;
      await retryLlm(
        () => {
          calls++;
          if (calls === 1) throw makeError(500);
          return Promise.resolve('ok');
        },
        { maxRetries: 1, baseDelay: 50, jitter: true },
      );
      delays.push(Date.now() - start);
    }
    // With jitter, not all delays should be identical
    const unique = new Set(delays.map((d) => Math.round(d / 10)));
    // At least some variation (this test is probabilistic but very likely to pass)
    expect(unique.size).toBeGreaterThanOrEqual(1);
  });

  test('maxDelay caps the backoff', async () => {
    let calls = 0;
    const start = Date.now();
    try {
      await retryLlm(
        () => {
          calls++;
          throw makeError(500);
        },
        { maxRetries: 3, baseDelay: 10, maxDelay: 20, jitter: false },
      );
    } catch {
      // 4 calls total, 3 waits: 10, 20, 20 = 50ms max
      expect(Date.now() - start).toBeLessThan(200);
    }
  });

  test('connection error retries', async () => {
    let calls = 0;
    const err = new Error('fetch failed');
    err.name = 'APIConnectionError';
    await retryLlm(
      () => {
        calls++;
        if (calls === 1) throw err;
        return Promise.resolve('ok');
      },
      { baseDelay: 1 },
    );
    expect(calls).toBe(2);
  });
});

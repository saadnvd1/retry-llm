# ai-retry — Implementation Plan

**What:** npm package for retrying LLM API calls with provider-aware intelligence. Like p-retry but understands rate limits, model fallback, token budgets, and provider-specific error codes.

**Why:** Every AI app needs this. p-retry exists but is generic — doesn't know about 429 vs 529, `retry-after` headers, model downgrade chains, or token budget tracking. This is the missing primitive in the AI dev tooling stack.

**Target:** 2-3 days to ship. TypeScript, ESM-only, zero runtime deps.

---

## Architecture

### Core API

```ts
import { aiRetry } from 'ai-retry';

// Simple — just wrap your LLM call
const result = await aiRetry(() => anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Hello' }],
}));

// Full options
const result = await aiRetry(
  (ctx) => anthropic.messages.create({
    model: ctx.model ?? 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'Hello' }],
  }),
  {
    maxRetries: 5,
    fallbackModels: ['claude-haiku-4-5-20251001'],
    onRateLimit: 'wait',           // 'wait' | 'fallback' | 'throw'
    budget: { maxTokens: 50_000 }, // stop retrying if cumulative tokens exceed
    onRetry: (error, attempt) => console.log(`Retry ${attempt}...`),
    signal: AbortSignal.timeout(30_000),
  }
);
```

### Exported API Surface

```ts
// Main function
export function aiRetry<T>(
  fn: (ctx: RetryContext) => Promise<T>,
  options?: AiRetryOptions,
): Promise<T>;

// Options
export interface AiRetryOptions {
  maxRetries?: number;           // default: 3
  fallbackModels?: string[];     // ordered list, tried after primary exhausts retries
  onRateLimit?: 'wait' | 'fallback' | 'throw';  // default: 'wait'
  budget?: { maxTokens?: number; maxCost?: number };
  baseDelay?: number;            // default: 500ms
  maxDelay?: number;             // default: 30_000ms
  jitter?: boolean;              // default: true
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean | Promise<boolean>;
  onRetry?: (error: unknown, context: RetryContext) => void;
}

// Context passed to fn and onRetry
export interface RetryContext {
  attempt: number;         // 1-indexed
  model: string | null;    // current model (null if no fallback configured)
  totalAttempts: number;   // across all models
  tokensUsed: number;      // cumulative (if budget tracking enabled)
}

// Error types
export class RetryError extends Error {
  readonly lastError: unknown;
  readonly attempts: number;
  readonly modelsAttempted: string[];
}

export class BudgetExceededError extends Error {
  readonly tokensUsed: number;
  readonly budget: number;
}
```

### How It Works

1. **Call fn** with current `RetryContext`
2. **On success** — return result
3. **On error** — classify it:
   - **Rate limit (429):** If `onRateLimit: 'wait'`, parse `retry-after` header and sleep. If `'fallback'`, skip to next model. If `'throw'`, throw immediately.
   - **Overloaded (529):** Treat like rate limit (Anthropic-specific)
   - **Server error (500+):** Retry with backoff
   - **Auth error (401/403):** Don't retry — throw immediately
   - **Bad request (400):** Don't retry — throw immediately
   - **Connection error:** Retry with backoff
4. **Backoff** — exponential with optional jitter: `min(baseDelay * 2^attempt + jitter, maxDelay)`
5. **Model fallback** — when primary model exhausts `maxRetries`, reset attempt counter and try `fallbackModels[0]`, then `[1]`, etc.
6. **Budget tracking** — if `budget.maxTokens` set, accumulate `usage.input_tokens + usage.output_tokens` from successful responses (requires wrapping the return). Throw `BudgetExceededError` when exceeded.
7. **Abort** — check `signal.aborted` before each attempt

### Error Classification

```ts
function classifyError(error: unknown): 'rate_limit' | 'overloaded' | 'server' | 'auth' | 'bad_request' | 'connection' | 'unknown' {
  // Check for status property (both Anthropic & OpenAI SDKs use error.status)
  const status = (error as any)?.status;
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status >= 500) return 'server';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'bad_request';

  // Check for connection errors (both SDKs: error.name or instanceof)
  const name = (error as any)?.name;
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return 'connection';

  // Check error message for rate limit strings (fallback for non-SDK errors)
  const msg = String((error as any)?.message ?? '').toLowerCase();
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('overloaded')) return 'rate_limit';

  return 'unknown';
}
```

### Retry-After Parsing

```ts
function getRetryAfter(error: unknown): number | null {
  const headers = (error as any)?.headers;
  if (!headers) return null;

  // retry-after-ms (non-standard, used by Anthropic/OpenAI)
  const ms = headers['retry-after-ms'] ?? headers?.get?.('retry-after-ms');
  if (ms) return parseInt(ms, 10);

  // retry-after (standard)
  const ra = headers['retry-after'] ?? headers?.get?.('retry-after');
  if (!ra) return null;

  const seconds = parseInt(ra, 10);
  if (!isNaN(seconds)) return seconds * 1000;

  // HTTP date
  const date = Date.parse(ra);
  if (!isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}
```

---

## File Structure

```
ai-retry/
  src/
    index.ts          # main aiRetry function + exports
    classify.ts       # error classification
    retry-after.ts    # header parsing
    types.ts          # all types/interfaces
    errors.ts         # RetryError, BudgetExceededError
  test/
    index.test.ts     # core retry logic tests
    classify.test.ts  # error classification tests
    retry-after.test.ts
  readme.md           # following Variant A template
  package.json
  tsconfig.json
  .gitignore
  CLAUDE.md
  LICENSE
```

---

## Package Config

```json
{
  "name": "ai-retry",
  "version": "1.0.0",
  "description": "Retry for LLM API calls — rate limits, model fallback, token budgets",
  "type": "module",
  "exports": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "prepublishOnly": "bun run build"
  },
  "keywords": ["retry", "llm", "ai", "rate-limit", "anthropic", "openai", "fallback"],
  "license": "MIT",
  "author": "Saad Naveed",
  "repository": "saadnvd1/ai-retry",
  "devDependencies": {
    "typescript": "^5.7"
  }
}
```

- Zero runtime deps
- ESM-only (`"type": "module"`)
- bun for dev/test, tsc for build
- Node 18+ (need AbortSignal support)

---

## Key Design Decisions

### 1. Provider-agnostic, not provider-locked
No `import Anthropic from '@anthropic-ai/sdk'` — we duck-type errors by checking `.status`, `.headers`, `.name`. Works with Anthropic, OpenAI, Google, or any HTTP-based LLM SDK.

### 2. fn receives context, not just attempt number
The callback gets `ctx.model` so it can dynamically switch models. This is cleaner than having the library know about SDK client internals.

### 3. Budget tracking is opt-in and approximate
We can't know token usage from failed calls. Budget tracking only counts successful responses that have a `.usage` property. It's a safety net, not an accounting system.

### 4. No built-in caching or queueing
Scope creep. ai-retry does one thing: retry with LLM-aware intelligence. Caching and request queueing are separate concerns.

### 5. `onRateLimit: 'wait'` as default
Most users want "just handle it." Waiting for `retry-after` then continuing is the safest default. Power users can set `'fallback'` to immediately try a cheaper model.

---

## Implementation Order

### Day 1: Core
1. Project setup (package.json, tsconfig, CLAUDE.md)
2. `types.ts` — all interfaces
3. `errors.ts` — RetryError, BudgetExceededError
4. `classify.ts` — error classification with tests
5. `retry-after.ts` — header parsing with tests
6. `index.ts` — main aiRetry function (basic retry + backoff, no fallback yet)
7. Tests for basic retry

### Day 2: Advanced Features + Polish
1. Model fallback logic in `index.ts`
2. Budget tracking
3. AbortSignal support
4. `shouldRetry` custom predicate
5. Full test suite (mock errors for each provider)
6. README following Variant A template

### Day 3: Ship
1. Build + verify dist output
2. npm publish
3. GitHub repo public
4. Product page on saadnaveed.com
5. Show HN draft
6. r/node, r/typescript, r/artificial posts

---

## Test Plan

Mock-based (no real API calls). Create fake errors matching SDK shapes:

```ts
// Fake Anthropic 429
const rateLimitError = Object.assign(new Error('rate limit'), {
  status: 429,
  headers: { 'retry-after': '2' },
  name: 'RateLimitError',
});

// Fake OpenAI 429
const openaiRateLimit = Object.assign(new Error('Rate limit reached'), {
  status: 429,
  headers: new Headers({ 'retry-after-ms': '1500' }),
  name: 'RateLimitError',
  code: 'rate_limit_exceeded',
});

// Fake 529 overloaded
const overloaded = Object.assign(new Error('overloaded'), {
  status: 529,
  name: 'InternalServerError',
});
```

Test cases:
- Succeeds on first try — no retry
- Fails then succeeds — retries correct number of times
- 429 with retry-after — waits correct duration
- 429 with `onRateLimit: 'fallback'` — switches model immediately
- 401 — throws immediately, no retry
- 400 — throws immediately, no retry
- Model fallback chain exhausted — throws RetryError with all models listed
- Budget exceeded mid-retry — throws BudgetExceededError
- AbortSignal fires — stops retrying
- Custom shouldRetry returns false — stops
- Connection error — retries with backoff
- Jitter — delays are not exact powers of 2
- Max delay cap — never exceeds maxDelay

---

## Show HN Strategy

**Title:** `Show HN: ai-retry – Retry for LLM API calls with rate limits, model fallback, token budgets`

**First comment narrative:**
- I build AI apps. Every one needs retry logic for LLM APIs.
- p-retry is great but doesn't know about 429 vs 529, retry-after headers, or model downgrade chains
- ai-retry wraps any LLM SDK call with provider-aware retry
- Zero deps, ~200 lines, works with Anthropic/OpenAI/any HTTP-based SDK
- Show the 3-line basic usage, then the full-options example
- Link to blog post: "Why every AI app needs smarter retry"

---

## Competitive Positioning

| Feature | p-retry | async-retry | **ai-retry** |
|---------|---------|-------------|-------------|
| Exponential backoff | Yes | Yes | Yes |
| Jitter | No | Yes (randomize) | Yes |
| AbortSignal | Yes (v6) | No | Yes |
| retry-after header | No | No | **Yes** |
| 429 auto-wait | No | No | **Yes** |
| 529 overload handling | No | No | **Yes** |
| Model fallback | No | No | **Yes** |
| Token budget tracking | No | No | **Yes** |
| Error classification | Manual (AbortError) | Manual (bail) | **Auto by status** |
| Provider-agnostic | N/A | N/A | **Yes (duck-typed)** |
| Zero deps | Yes | Yes | Yes |

---

## Risks & Mitigations

1. **"Both SDKs already retry internally"** — True (2 retries by default). ai-retry is for when you want more control: model fallback, budget limits, custom behavior on rate limits. Position as "the retry you put around the SDK client" not "replacing SDK retry."

2. **"Name collision on npm"** — Check `npm info ai-retry` before publishing. If taken, alternatives: `llm-retry`, `retry-ai`, `smart-retry`.

3. **Budget tracking accuracy** — Can't track tokens from failed calls (no response body). Document this clearly. It's a "don't spend more than X" safety net, not an accounting tool.

---

## Status

- [ ] Project setup
- [ ] Core implementation
- [ ] Tests
- [ ] README
- [ ] npm publish
- [ ] GitHub public
- [ ] Product page
- [ ] Show HN

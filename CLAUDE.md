# retry-llm

npm package: `retry-llm`

## What this is

Smart retry for LLM API calls. Provider-agnostic (Anthropic, OpenAI, any HTTP SDK). Handles rate limits, model fallback, token budgets.

## Architecture

- `src/index.ts` — main `retryLlm()` function + re-exports
- `src/classify.ts` — error classification by status code / error name / message
- `src/retry-after.ts` — parse retry-after headers (ms, seconds, HTTP date)
- `src/types.ts` — all interfaces
- `src/errors.ts` — RetryError, BudgetExceededError

## Conventions

- Zero runtime dependencies
- ESM-only, TypeScript, Node 18+
- bun for dev/test, tsc for build
- Tests are mock-based (no real API calls)

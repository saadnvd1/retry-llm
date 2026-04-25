export type ErrorClass =
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'auth'
  | 'bad_request'
  | 'connection'
  | 'unknown';

export function classifyError(error: unknown): ErrorClass {
  const status = (error as any)?.status;

  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status >= 500) return 'server';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'bad_request';

  const name = (error as any)?.name;
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return 'connection';

  const msg = String((error as any)?.message ?? '').toLowerCase();
  if (msg.includes('rate limit') || msg.includes('too many requests')) return 'rate_limit';
  if (msg.includes('overloaded')) return 'overloaded';

  if (error instanceof TypeError && msg.includes('fetch')) return 'connection';

  return 'unknown';
}

export function isRetryable(errorClass: ErrorClass): boolean {
  return errorClass === 'rate_limit'
    || errorClass === 'overloaded'
    || errorClass === 'server'
    || errorClass === 'connection'
    || errorClass === 'unknown';
}

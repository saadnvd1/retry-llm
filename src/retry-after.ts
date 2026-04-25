export function getRetryAfter(error: unknown): number | null {
  const headers = (error as any)?.headers;
  if (!headers) return null;

  const get = (key: string): string | undefined => {
    if (typeof headers.get === 'function') return headers.get(key) ?? undefined;
    return headers[key];
  };

  const ms = get('retry-after-ms');
  if (ms) {
    const parsed = parseInt(ms, 10);
    if (!isNaN(parsed)) return parsed;
  }

  const ra = get('retry-after');
  if (!ra) return null;

  const seconds = parseInt(ra, 10);
  if (!isNaN(seconds)) return seconds * 1000;

  const date = Date.parse(ra);
  if (!isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

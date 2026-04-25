import { describe, test, expect } from 'bun:test';
import { getRetryAfter } from '../src/retry-after';

describe('getRetryAfter', () => {
  test('retry-after-ms from plain object headers', () => {
    const err = { headers: { 'retry-after-ms': '1500' } };
    expect(getRetryAfter(err)).toBe(1500);
  });

  test('retry-after-ms from Headers object', () => {
    const err = { headers: new Headers({ 'retry-after-ms': '2000' }) };
    expect(getRetryAfter(err)).toBe(2000);
  });

  test('retry-after in seconds from plain object', () => {
    const err = { headers: { 'retry-after': '3' } };
    expect(getRetryAfter(err)).toBe(3000);
  });

  test('retry-after in seconds from Headers object', () => {
    const err = { headers: new Headers({ 'retry-after': '5' }) };
    expect(getRetryAfter(err)).toBe(5000);
  });

  test('retry-after-ms takes priority over retry-after', () => {
    const err = { headers: { 'retry-after-ms': '500', 'retry-after': '10' } };
    expect(getRetryAfter(err)).toBe(500);
  });

  test('no headers -> null', () => {
    expect(getRetryAfter(new Error('no headers'))).toBeNull();
  });

  test('empty headers -> null', () => {
    expect(getRetryAfter({ headers: {} })).toBeNull();
  });

  test('null error -> null', () => {
    expect(getRetryAfter(null)).toBeNull();
  });
});

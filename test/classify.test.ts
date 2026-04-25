import { describe, test, expect } from 'bun:test';
import { classifyError } from '../src/classify';

describe('classifyError', () => {
  test('429 -> rate_limit', () => {
    expect(classifyError({ status: 429, message: '' })).toBe('rate_limit');
  });

  test('529 -> overloaded', () => {
    expect(classifyError({ status: 529, message: '' })).toBe('overloaded');
  });

  test('500 -> server', () => {
    expect(classifyError({ status: 500, message: '' })).toBe('server');
  });

  test('502 -> server', () => {
    expect(classifyError({ status: 502, message: '' })).toBe('server');
  });

  test('401 -> auth', () => {
    expect(classifyError({ status: 401, message: '' })).toBe('auth');
  });

  test('403 -> auth', () => {
    expect(classifyError({ status: 403, message: '' })).toBe('auth');
  });

  test('400 -> bad_request', () => {
    expect(classifyError({ status: 400, message: '' })).toBe('bad_request');
  });

  test('422 -> bad_request', () => {
    expect(classifyError({ status: 422, message: '' })).toBe('bad_request');
  });

  test('413 -> bad_request', () => {
    expect(classifyError({ status: 413, message: '' })).toBe('bad_request');
  });

  test('APIConnectionError name -> connection', () => {
    const err = new Error('connection failed');
    err.name = 'APIConnectionError';
    expect(classifyError(err)).toBe('connection');
  });

  test('APIConnectionTimeoutError name -> connection', () => {
    const err = new Error('timeout');
    err.name = 'APIConnectionTimeoutError';
    expect(classifyError(err)).toBe('connection');
  });

  test('message "rate limit" -> rate_limit', () => {
    expect(classifyError(new Error('You hit the rate limit'))).toBe('rate_limit');
  });

  test('message "too many requests" -> rate_limit', () => {
    expect(classifyError(new Error('too many requests'))).toBe('rate_limit');
  });

  test('message "overloaded" -> overloaded', () => {
    expect(classifyError(new Error('model is overloaded'))).toBe('overloaded');
  });

  test('unknown error -> unknown', () => {
    expect(classifyError(new Error('something weird'))).toBe('unknown');
  });

  test('null -> unknown', () => {
    expect(classifyError(null)).toBe('unknown');
  });

  test('string -> unknown', () => {
    expect(classifyError('some error')).toBe('unknown');
  });
});

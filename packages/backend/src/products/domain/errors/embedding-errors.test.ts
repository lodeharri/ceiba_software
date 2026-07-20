/**
 * RED fixture: verify 3 new embedding domain error classes.
 * GREEN: implement the classes.
 * TRIANGULATE: edge cases (empty string, provider '', super(cause)).
 */

import { describe, it, expect } from 'vitest';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

// These imports will fail at compile time until the files are created
const EmbeddingProviderUnavailableError = await import('./embedding-provider-unavailable.js').then(
  (m) => m.EmbeddingProviderUnavailableError,
);
const EmbeddingInputTooLongError = await import('./embedding-input-too-long.js').then(
  (m) => m.EmbeddingInputTooLongError,
);
const InvalidSemanticSearchQueryError = await import('./invalid-semantic-search-query.js').then(
  (m) => m.InvalidSemanticSearchQueryError,
);

describe('EmbeddingProviderUnavailableError', () => {
  it('extends BaseDomainError', () => {
    const err = new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
    expect(err instanceof BaseDomainError).toBe(true);
  });

  it('has correct code and httpStatus', () => {
    const err = new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
    expect(err.code).toBe('EMBEDDING_PROVIDER_UNAVAILABLE');
    expect(err.httpStatus).toBe(503);
  });

  it('has details with provider and reason', () => {
    const err = new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
    expect(err.details).toEqual({ provider: 'gemini', reason: 'ssm-fetch-failed' });
  });

  it('roundtrips empty provider as-is in details', () => {
    const err = new EmbeddingProviderUnavailableError('', 'missing-api-key');
    expect(err.details).toEqual({ provider: '', reason: 'missing-api-key' });
  });

  it('super(cause) propagates when supplied', () => {
    const cause = new Error('original cause');
    const err = new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('EmbeddingInputTooLongError', () => {
  it('extends BaseDomainError', () => {
    const err = new EmbeddingInputTooLongError(8193);
    expect(err instanceof BaseDomainError).toBe(true);
  });

  it('has correct code and httpStatus', () => {
    const err = new EmbeddingInputTooLongError(8193);
    expect(err.code).toBe('EMBEDDING_INPUT_TOO_LONG');
    expect(err.httpStatus).toBe(400);
  });

  it('has details with length', () => {
    const err = new EmbeddingInputTooLongError(8193);
    expect(err.details).toEqual({ length: 8193 });
  });

  it('empty-string query yields length 0', () => {
    const err = new EmbeddingInputTooLongError(0);
    expect(err.details).toEqual({ length: 0 });
  });

  it('super(cause) propagates when supplied', () => {
    const cause = new Error('original cause');
    const err = new EmbeddingInputTooLongError(8193, { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('InvalidSemanticSearchQueryError', () => {
  it('extends BaseDomainError', () => {
    const err = new InvalidSemanticSearchQueryError('ab');
    expect(err instanceof BaseDomainError).toBe(true);
  });

  it('has correct code and httpStatus', () => {
    const err = new InvalidSemanticSearchQueryError('ab');
    expect(err.code).toBe('INVALID_SEMANTIC_SEARCH_QUERY');
    expect(err.httpStatus).toBe(400);
  });

  it('has details with queryLength', () => {
    const err = new InvalidSemanticSearchQueryError('ab');
    expect(err.details).toEqual({ queryLength: 2 });
  });

  it('empty-string query yields queryLength 0', () => {
    const err = new InvalidSemanticSearchQueryError('');
    expect(err.details).toEqual({ queryLength: 0 });
  });

  it('super(cause) propagates when supplied', () => {
    const cause = new Error('original cause');
    const err = new InvalidSemanticSearchQueryError('ab', { cause });
    expect(err.cause).toBe(cause);
  });
});

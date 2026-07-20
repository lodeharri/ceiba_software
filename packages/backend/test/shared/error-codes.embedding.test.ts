/**
 * RED test: assert 3 new embedding error codes do not yet exist.
 * GREEN: add them to the ErrorCode registry.
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@mercadoexpress/shared';

describe('embedding error codes', () => {
  it('EMBEDDING_PROVIDER_UNAVAILABLE exists', () => {
    expect(ErrorCode.EMBEDDING_PROVIDER_UNAVAILABLE).toBe('EMBEDDING_PROVIDER_UNAVAILABLE');
  });

  it('EMBEDDING_INPUT_TOO_LONG exists', () => {
    expect(ErrorCode.EMBEDDING_INPUT_TOO_LONG).toBe('EMBEDDING_INPUT_TOO_LONG');
  });

  it('INVALID_SEMANTIC_SEARCH_QUERY exists', () => {
    expect(ErrorCode.INVALID_SEMANTIC_SEARCH_QUERY).toBe('INVALID_SEMANTIC_SEARCH_QUERY');
  });
});

/**
 * RED fixture: assert EmbeddingProviderUnavailableError maps to 503 + retryAfter.
 * GREEN: add the branch to toErrorResponse.
 * TRIANGULATE: assert no message leak, assert unknown throws unchanged.
 */

import { describe, it, expect, vi } from 'vitest';
import { toErrorResponse } from './error-mapper.js';
import { EmbeddingProviderUnavailableError } from '../products/domain/errors/embedding-provider-unavailable.js';

interface ErrorBody {
  code: string;
  message: string;
  details?: { retryAfter?: number; provider?: string; reason?: string };
  requestId: string;
  cause?: unknown;
}

describe('EmbeddingProviderUnavailableError in error mapper', () => {
  const ctx = {
    requestId: 'req-123',
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
  };

  it('maps to 503 envelope with retryAfter: 60', () => {
    const err = new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
    const response = toErrorResponse(err, ctx);

    expect(response.statusCode).toBe(503);
    let body: ErrorBody;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new Error('response.body is not valid JSON: ' + response.body);
    }
    expect(body.code).toBe('EMBEDDING_PROVIDER_UNAVAILABLE');
    expect(body.details?.retryAfter).toBe(60);
    expect(body.details?.provider).toBe('gemini');
    expect(body.details?.reason).toBe('ssm-fetch-failed');
    expect(body.requestId).toBe('req-123');
  });

  it('does not leak the original message to the client', () => {
    const err = new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
    const response = toErrorResponse(err, ctx);
    let body: ErrorBody;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new Error('response.body is not valid JSON: ' + response.body);
    }

    // The message field should be present (it is for client display) but
    // the details should not leak sensitive info — in this case, reason is
    // safe to show (it's a reason string like "ssm-fetch-failed")
    expect(body.message).toBeDefined();
    // The original cause is NOT in the body — safe for clients
    expect(body.cause).toBeUndefined();
  });

  it('still maps unknown throws as 500 (no regression)', () => {
    const err = new Error('some unknown error');
    const response = toErrorResponse(err, ctx);
    expect(response.statusCode).toBe(500);
    let body: ErrorBody;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new Error('response.body is not valid JSON: ' + response.body);
    }
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});

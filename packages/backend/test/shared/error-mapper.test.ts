/**
 * RED-first test for error-mapper (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - NotFoundError → 404 NOT_FOUND
 *   - ValidationError → 422 VALIDATION_ERROR
 *   - ConflictError → 409 with code from errorCodes
 *   - RateLimitedError → 429 RATE_LIMITED
 *   - Unknown error → 500 INTERNAL_ERROR, NEVER echoes message
 */

import { describe, it, expect } from 'vitest';

describe('toErrorResponse (error-mapper)', () => {
  it('maps NotFoundError → 404 envelope with code NOT_FOUND', async () => {
    const { toErrorResponse } = await import('../../src/shared/error-mapper.js');
    const { NotFoundError } = await import('../../src/shared/errors/typed-errors.js');

    const result = toErrorResponse(new NotFoundError('Resource X'), { requestId: 'r-1' });

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toBeTruthy();
  });

  it('maps ValidationError → 422 envelope with code VALIDATION_ERROR', async () => {
    const { toErrorResponse } = await import('../../src/shared/error-mapper.js');
    const { ValidationError } = await import('../../src/shared/errors/typed-errors.js');

    const result = toErrorResponse(new ValidationError('Field "sku" is invalid.'), {
      requestId: 'r-2',
    });

    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('maps ConflictError → 409 envelope with code from errorCodes', async () => {
    const { toErrorResponse } = await import('../../src/shared/error-mapper.js');
    const { ConflictError } = await import('../../src/shared/errors/typed-errors.js');
    // The mapper accepts any ConflictError(code, ...) variant.
    const result = toErrorResponse(new ConflictError('SKU_ALREADY_EXISTS', 'SKU exists'), {
      requestId: 'r-3',
    });

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('SKU_ALREADY_EXISTS');
  });

  it('maps RateLimitedError → 429 envelope with code RATE_LIMITED', async () => {
    const { toErrorResponse } = await import('../../src/shared/error-mapper.js');
    const { RateLimitedError } = await import('../../src/shared/errors/typed-errors.js');

    const result = toErrorResponse(new RateLimitedError(60), { requestId: 'r-4' });

    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.details?.['retryAfterSeconds']).toBe(60);
  });

  it('maps an unknown error → 500 INTERNAL_ERROR and never echoes the original message', async () => {
    const { toErrorResponse } = await import('../../src/shared/error-mapper.js');

    const result = toErrorResponse(new Error('super-secret-internal-stack-trace'), {
      requestId: 'r-5',
    });

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('super-secret-internal-stack-trace');
  });

  it('echoes the X-Request-Id header back', async () => {
    const { toErrorResponse } = await import('../../src/shared/error-mapper.js');

    const result = toErrorResponse(new Error('boom'), { requestId: 'r-abc-123' });

    expect(result.headers?.['X-Request-Id']).toBe('r-abc-123');
  });
});

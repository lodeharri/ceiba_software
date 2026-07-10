/**
 * Typed Domain Errors (PR 1, design.md §11).
 *
 * Concrete subclasses of `BaseDomainError`. Each one carries a fixed
 * `(code, httpStatus)` pair — the application/domain layers throw these,
 * and the `error-mapper.ts` translates them to HTTP envelopes.
 *
 * Tests in `test/shared/error-mapper.test.ts` pin the mapping. PR 2a+
 * extends this file with BC-specific errors (e.g. `StockWouldGoNegativeError`),
 * but the canonical HTTP shape stays the same.
 */

import { ErrorCode, type ErrorCodeValue } from '@mercadoexpress/shared';
import { BaseDomainError } from './base-domain-error.js';

export class NotFoundError extends BaseDomainError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: ErrorCode.NOT_FOUND,
      httpStatus: 404,
      message,
      ...(details !== undefined ? { details } : {}),
    });
  }
}

export class ValidationError extends BaseDomainError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      httpStatus: 422,
      message,
      ...(details !== undefined ? { details } : {}),
    });
  }
}

/**
 * 409 Conflict — generic. BC-specific conflicts (SKU_ALREADY_EXISTS, etc.)
 * extend this with a typed `code` literal so the mapper picks it up.
 */
export class ConflictError extends BaseDomainError {
  public constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>) {
    super({ code, httpStatus: 409, message, ...(details !== undefined ? { details } : {}) });
  }
}

export class UnauthorizedError extends BaseDomainError {
  public constructor(code: ErrorCodeValue = ErrorCode.UNAUTHORIZED, message = 'Unauthorized') {
    super({ code, httpStatus: 401, message });
  }
}

export class RateLimitedError extends BaseDomainError {
  public readonly retryAfterSeconds: number;
  public constructor(retryAfterSeconds: number, message = 'Too Many Requests') {
    super({
      code: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
      message,
      details: { retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class InternalError extends BaseDomainError {
  public constructor(message = 'Internal Server Error', details?: Record<string, unknown>) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      httpStatus: 500,
      message,
      ...(details !== undefined ? { details } : {}),
    });
  }
}

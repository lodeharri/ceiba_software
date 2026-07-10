/**
 * ApiError helper (PR 1).
 *
 * Tiny convenience builder so handlers can throw
 *   throw apiError(404, 'NOT_FOUND', '...', { id: 'p-1' });
 * instead of importing the matching `BaseDomainError` subclass.
 * The mapper handles these identically.
 */

import type { ErrorCodeValue as ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from './errors/base-domain-error.js';

export function apiError(
  httpStatus: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): BaseDomainError {
  // Inline class so the constructor name appears as `ApiError` in logs.
  class ApiError extends BaseDomainError {
    public constructor() {
      super({ code, httpStatus, message, ...(details !== undefined ? { details } : {}) });
    }
  }
  return new ApiError();
}

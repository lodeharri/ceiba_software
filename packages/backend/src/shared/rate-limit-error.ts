/**
 * Rate limit error helper (PR 1).
 *
 * Convenience wrapper for `RateLimitedError` so handlers can throw
 * `throw rateLimited(60)` to express "retry after 60s". The mapper
 * sets `Retry-After` from `retryAfterSeconds`.
 */

import { RateLimitedError } from './errors/typed-errors.js';

export function rateLimited(retryAfterSeconds: number, message?: string): RateLimitedError {
  return new RateLimitedError(retryAfterSeconds, message);
}

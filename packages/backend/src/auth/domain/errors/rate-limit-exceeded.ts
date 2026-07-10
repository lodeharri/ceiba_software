/**
 * Auth BC — RateLimitExceededError (PR 2a, RISK-003).
 *
 * 429 RATE_LIMITED — fires when the (ip, username) pair has hit
 * 5 failures within the rolling 15-minute window.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class RateLimitExceededError extends BaseDomainError {
  public readonly retryAfterSeconds: number;

  public constructor(retryAfterSeconds: number) {
    super({
      code: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
      message: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(
        retryAfterSeconds / 60,
      )} minutos.`,
      details: { retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

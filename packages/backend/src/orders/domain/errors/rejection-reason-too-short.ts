/**
 * Orders BC — RejectionReasonTooShortError (PR 2c, BR-D2).
 *
 * Thrown when a reject call provides a reason with fewer than 10 characters.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class RejectionReasonTooShortError extends BaseDomainError {
  constructor(provided: number, minimum: number = 10) {
    super({
      code: ErrorCode.REJECTION_REASON_TOO_SHORT,
      httpStatus: 422,
      message: `El motivo debe tener al menos ${minimum} caracteres.`,
      details: { provided, minimum },
    });
  }
}

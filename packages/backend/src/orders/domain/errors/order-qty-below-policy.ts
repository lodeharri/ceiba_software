/**
 * Orders BC — OrderQtyBelowPolicyError (PR 2c, BR-2).
 *
 * Thrown when the order quantity is less than 2 × stockMin.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class OrderQtyBelowPolicyError extends BaseDomainError {
  constructor(requested: number, minimum: number, stockMin: number) {
    super({
      code: ErrorCode.ORDER_QTY_BELOW_POLICY,
      httpStatus: 422,
      message: 'La cantidad solicitada debe ser al menos 2 veces el stock mínimo.',
      details: { requested, minimum, stockMin },
    });
  }
}

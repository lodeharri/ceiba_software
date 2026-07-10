/**
 * Orders BC — OrderNotFoundError (PR 2c).
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class OrderNotFoundError extends BaseDomainError {
  constructor(orderId: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      httpStatus: 404,
      message: `Order not found: ${orderId}`,
      details: { orderId },
    });
  }
}

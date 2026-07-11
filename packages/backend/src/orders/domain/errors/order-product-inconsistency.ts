import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

/**
 * Thrown when an order references a product that does not exist in the
 * products BC. This is a cross-BC data inconsistency — the order was
 * created against a product that has since been removed or is unreachable.
 *
 * Mirrors `AlertProductInconsistencyError` (alerts BC). Only thrown by
 * `GetOrderUseCase`; `ListOrdersUseCase` silently drops orders whose
 * product is gone (the partial unique constraints in the schema make this
 * race narrow and the UI would otherwise render undefined fields).
 */
export class OrderProductInconsistencyError extends BaseDomainError {
  constructor(orderId: string, productId: string) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      httpStatus: 422,
      message: `Order ${orderId} references non-existent product ${productId}.`,
      details: { orderId, productId },
    });
  }
}

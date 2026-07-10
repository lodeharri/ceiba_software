import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

/**
 * Thrown when an alert references a product that does not exist in the
 * products BC. This is a cross-BC data inconsistency — the alert was
 * created by inventory but the product has since been removed or is
 * unreachable.
 */
export class AlertProductInconsistencyError extends BaseDomainError {
  constructor(alertId: string, productId: string) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      httpStatus: 422,
      message: `Alert ${alertId} references non-existent product ${productId}.`,
      details: { alertId, productId },
    });
  }
}

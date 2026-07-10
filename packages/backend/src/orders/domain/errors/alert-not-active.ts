/**
 * Orders BC — AlertNotActiveError (PR 2c, orders/spec.md "fromAlertId must reference ACTIVA alert").
 *
 * Thrown when `fromAlertId` is provided but:
 *   (a) no alert exists with that id
 *   (b) the alert's status is RESUELTA
 *   (c) the alert's productId differs from the order's productId
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class AlertNotActiveError extends BaseDomainError {
  constructor(alertId: string, reason: 'missing' | 'resolved' | 'product_mismatch') {
    const messages: Record<string, string> = {
      missing: `Alert ${alertId} does not exist.`,
      resolved: `Alert ${alertId} is already resolved.`,
      product_mismatch: `Alert ${alertId} belongs to a different product.`,
    };
    const msg = messages[reason] ?? messages['missing']!;
    super({
      code: ErrorCode.ALERT_NOT_ACTIVE,
      httpStatus: 422,
      message: msg,
      details: { alertId, reason },
    });
  }
}

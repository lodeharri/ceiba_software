/**
 * Orders BC — OrderInvalidTransitionError (PR 2c).
 *
 * Thrown when a transition is not in the legal BR-5 state machine.
 * Examples:
 *   - Approve from non-PENDIENTE
 *   - Reject from non-PENDIENTE
 *   - Receive from non-APROBADA
 *   - Any transition from RECHAZADA or RECIBIDA
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class OrderInvalidTransitionError extends BaseDomainError {
  constructor(fromStatus: string, action: string) {
    const message = `Cannot ${action} order in state ${fromStatus}.`;
    super({
      code: ErrorCode.ORDER_INVALID_TRANSITION,
      httpStatus: 409,
      message,
      details: { fromStatus, action },
    });
  }
}

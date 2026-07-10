import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class AlertNotFoundError extends BaseDomainError {
  constructor(alertId: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      httpStatus: 404,
      message: `Alert not found: ${alertId}`,
    });
  }
}

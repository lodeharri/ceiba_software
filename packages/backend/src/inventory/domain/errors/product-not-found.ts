import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class ProductNotFoundError extends BaseDomainError {
  constructor(productId: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      httpStatus: 404,
      message: `Product not found: ${productId}`,
    });
  }
}

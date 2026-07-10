/**
 * Products BC — ProductNotFoundError (PR 2a, products/spec.md).
 *
 * 404 PRODUCT_NOT_FOUND — fired by get-product and update-product
 * use cases when the id is absent from the repository.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class ProductNotFoundError extends BaseDomainError {
  public readonly productId: string;

  public constructor(productId: string) {
    super({
      code: ErrorCode.PRODUCT_NOT_FOUND,
      httpStatus: 404,
      message: `No existe el producto '${productId}'.`,
      details: { productId },
    });
    this.productId = productId;
  }
}

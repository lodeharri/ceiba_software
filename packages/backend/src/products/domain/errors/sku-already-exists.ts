/**
 * Products BC — SkuAlreadyExistsError (PR 2a, products/spec.md).
 *
 * 409 SKU_ALREADY_EXISTS — fired by the create use case when
 * `findBySku` returns an existing product, or by the adapter when
 * the DB unique constraint trips (Prisma P2002).
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class SkuAlreadyExistsError extends BaseDomainError {
  public readonly sku: string;
  public readonly existingProductId: string | undefined;

  public constructor(sku: string, existingProductId?: string) {
    super({
      code: ErrorCode.SKU_ALREADY_EXISTS,
      httpStatus: 409,
      message: `Ya existe un producto con el SKU '${sku}'.`,
      details: { sku, ...(existingProductId ? { existingProductId } : {}) },
    });
    this.sku = sku;
    this.existingProductId = existingProductId;
  }
}

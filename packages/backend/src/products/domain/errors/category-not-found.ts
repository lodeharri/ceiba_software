/**
 * Products BC — CategoryNotFoundError (PR 2a, products/spec.md).
 *
 * 422 CATEGORY_NOT_FOUND — fired by the create use case when the
 * `categoryId` field doesn't refer to an existing category row.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class CategoryNotFoundError extends BaseDomainError {
  public readonly categoryId: string;

  public constructor(categoryId: string) {
    super({
      code: ErrorCode.CATEGORY_NOT_FOUND,
      httpStatus: 422,
      message: `La categoría '${categoryId}' no existe.`,
      details: { categoryId },
    });
    this.categoryId = categoryId;
  }
}

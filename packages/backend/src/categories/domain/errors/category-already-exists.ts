/**
 * Categories BC — CategoryAlreadyExistsError (PR 2a, categories/spec.md).
 *
 * 409 CATEGORY_NAME_EXISTS — fired by the create-category use case when
 * the given name already exists.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class CategoryAlreadyExistsError extends BaseDomainError {
  public override readonly name: string;
  public readonly existingCategoryId: string | undefined;

  public constructor(name: string, existingCategoryId?: string) {
    super({
      code: ErrorCode.CATEGORY_NAME_EXISTS,
      httpStatus: 409,
      message: `Ya existe una categoría con el nombre '${name}'.`,
      details: { name, ...(existingCategoryId ? { existingCategoryId } : {}) },
    });
    this.name = name;
    this.existingCategoryId = existingCategoryId;
  }
}

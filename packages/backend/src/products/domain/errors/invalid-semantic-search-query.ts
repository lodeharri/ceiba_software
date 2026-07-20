/**
 * InvalidSemanticSearchQueryError (R9, spec.md §5.1).
 *
 * Thrown when the semantic search query fails validation:
 * - query.length < 3 or > 1024
 */

import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { ErrorCode } from '@mercadoexpress/shared';

export class InvalidSemanticSearchQueryError extends BaseDomainError {
  constructor(
    public readonly query: string,
    options?: { cause?: unknown },
  ) {
    super({
      code: ErrorCode.INVALID_SEMANTIC_SEARCH_QUERY,
      httpStatus: 400,
      message: 'Query must be between 3 and 1024 characters',
      details: { queryLength: query.length },
      ...options,
    });
  }
}

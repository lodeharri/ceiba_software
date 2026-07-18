/**
 * EmbeddingInputTooLongError (R5, spec.md §5.1).
 *
 * Thrown when the text input to the embedding adapter exceeds the
 * maximum allowed length (8192 characters for Gemini).
 */

import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { ErrorCode } from '@mercadoexpress/shared';

export class EmbeddingInputTooLongError extends BaseDomainError {
  constructor(
    public readonly length: number,
    options?: { cause?: unknown },
  ) {
    super({
      code: ErrorCode.EMBEDDING_INPUT_TOO_LONG,
      httpStatus: 400,
      message: `Embedding input exceeds maximum length of 8192 characters (got ${length})`,
      details: { length },
      ...options,
    });
  }
}

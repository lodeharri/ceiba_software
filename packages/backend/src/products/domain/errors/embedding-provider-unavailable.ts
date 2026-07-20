/**
 * EmbeddingProviderUnavailableError (R5, spec.md §5.1).
 *
 * Thrown when the embedding provider is unavailable due to:
 * - SSM fetch failure (missing key, access denied)
 * - Network error reaching the provider
 * - HTTP errors after all retry attempts exhausted
 */

import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { ErrorCode } from '@mercadoexpress/shared';

export class EmbeddingProviderUnavailableError extends BaseDomainError {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super({
      code: ErrorCode.EMBEDDING_PROVIDER_UNAVAILABLE,
      httpStatus: 503,
      message: `Embedding provider '${provider}' is unavailable: ${reason}`,
      details: { provider, reason },
      ...options,
    });
  }
}

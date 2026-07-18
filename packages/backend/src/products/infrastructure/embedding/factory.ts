/**
 * EmbeddingFactory — selects and memoizes the EmbeddingPort adapter.
 *
 * Design: design.md §3 R3, Requirement 3.
 */

import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import { GeminiEmbeddingAdapter } from './gemini-adapter.js';
import type { Logger as PinoLogger } from 'pino';

export interface BuildProviderSettings {
  provider: string;
  apiKey?: string;
  logger: PinoLogger;
  httpClient?: typeof fetch;
}

/**
 * Build an EmbeddingPort for the given provider.
 * Selects the concrete adapter by env-controlled `EMBEDDING_PROVIDER`.
 * Fails closed on unknown providers or missing credentials.
 *
 * Adding a new provider: add a `case` here + a new adapter file. Nothing else.
 */
export function buildEmbeddingProvider(settings: BuildProviderSettings): EmbeddingPort {
  switch (settings.provider) {
    case 'gemini': {
      if (!settings.apiKey) {
        throw new EmbeddingProviderUnavailableError('gemini', 'missing-api-key');
      }
      return new GeminiEmbeddingAdapter({
        apiKey: settings.apiKey,
        logger: settings.logger,
        ...(settings.httpClient ? { httpClient: settings.httpClient } : {}),
      });
    }
    default:
      throw new EmbeddingProviderUnavailableError(settings.provider, 'unknown-provider');
  }
}

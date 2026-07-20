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

/** Module-level singleton cache — per provider name, per spec R3 Scenario 3.4 */
const cache = new Map<string, EmbeddingPort>();

/**
 * Build an EmbeddingPort for the given provider.
 * Selects the concrete adapter by env-controlled `EMBEDDING_PROVIDER`.
 * Fails closed on unknown providers or missing credentials.
 *
 * Adding a new provider: add a `case` here + a new adapter file. Nothing else.
 */
export function buildEmbeddingProvider(settings: BuildProviderSettings): EmbeddingPort {
  const cached = cache.get(settings.provider);
  if (cached) return cached;

  switch (settings.provider) {
    case 'gemini': {
      if (!settings.apiKey) {
        throw new EmbeddingProviderUnavailableError('gemini', 'missing-api-key');
      }
      const adapter = new GeminiEmbeddingAdapter({
        apiKey: settings.apiKey,
        logger: settings.logger,
        ...(settings.httpClient ? { httpClient: settings.httpClient } : {}),
      });
      cache.set(settings.provider, adapter);
      return adapter;
    }
    default:
      throw new EmbeddingProviderUnavailableError(settings.provider, 'unknown-provider');
  }
}

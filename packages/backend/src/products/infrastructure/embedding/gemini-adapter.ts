/**
 * GeminiEmbeddingAdapter — concrete EmbeddingPort implementation using Gemini API.
 *
 * Design: design.md §3 R2, Requirement 2 (spec.md).
 *
 * Features:
 * - HTTP client is injectable (default: globalThis.fetch)
 * - Input validation: 8192 char cap
 * - Retry: 3 attempts with exponential backoff (1s/2s/4s)
 * - Pino logger with redaction — apiKey never appears in logs
 */

import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import { EmbeddingInputTooLongError } from '../../domain/errors/embedding-input-too-long.js';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import type { Logger as PinoLogger } from 'pino';

const GEMINI_EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const MAX_INPUT_CHARS = 8192;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface GeminiAdapterDeps {
  apiKey: string;
  httpClient?: typeof fetch;
  logger: PinoLogger;
  /** Injectable delay — defaults to setTimeout. Pass () => Promise.resolve() in tests. */
  delayFn?: (ms: number) => Promise<void>;
}

export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly http: typeof fetch;
  private readonly log: PinoLogger;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly deps: GeminiAdapterDeps) {
    this.http = deps.httpClient ?? globalThis.fetch;
    this.log = deps.logger.child({ component: 'GeminiEmbeddingAdapter' });
    this.delay = deps.delayFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async embed(text: string): Promise<readonly number[]> {
    if (text.length > MAX_INPUT_CHARS) {
      throw new EmbeddingInputTooLongError(text.length);
    }
    return this.withRetry(() => this.callGemini(text));
  }

  async embedBatch(texts: string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  private async callGemini(text: string): Promise<readonly number[]> {
    const url = `${GEMINI_EMBEDDING_URL}?key=${this.deps.apiKey}`;
    const body = JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    });
    const res = await this.http(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const reason = `HTTP ${res.status}`;
      throw new EmbeddingProviderUnavailableError('gemini', reason);
    }
    const json = (await res.json()) as { embedding: { values: number[] } };
    const values = json.embedding.values;
    if (!Array.isArray(values) || values.length !== 768) {
      throw new EmbeddingProviderUnavailableError('gemini', 'invalid-dimension: expected 768');
    }
    this.log.info({
      provider: 'gemini',
      statusCode: res.status,
      responseBytes: JSON.stringify(body).length,
    });
    return values;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      const t0 = Date.now();
      try {
        const result = await fn();
        this.log.info(
          {
            provider: 'gemini',
            attempt,
            latencyMs: Date.now() - t0,
            outcome: 'success',
          },
          'Embedding succeeded',
        );
        return result;
      } catch (err) {
        lastError = err;
        const isLastAttempt = attempt > RETRY_DELAYS_MS.length;
        this.log.warn(
          {
            provider: 'gemini',
            attempt,
            latencyMs: Date.now() - t0,
            outcome: isLastAttempt ? 'exhausted' : 'retry',
            reason: lastError instanceof Error ? lastError.message : String(lastError),
          },
          isLastAttempt
            ? 'Embedding failed after all retries'
            : 'Embedding attempt failed, will retry',
        );
        if (isLastAttempt) throw lastError;
        const delay = RETRY_DELAYS_MS[attempt - 1]!;
        await this.delay(delay);
      }
    }
    throw lastError;
  }
}

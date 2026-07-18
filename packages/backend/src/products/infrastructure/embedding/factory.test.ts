/**
 * Tests for EmbeddingFactory — buildEmbeddingProvider singleton + fail-closed.
 *
 * Strict TDD: RED first (file doesn't exist → tests fail).
 * GREEN: implement per design.md §3 R3.
 * TRIANGULATE: add singleton + constructor call-count assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildEmbeddingProvider } from './factory.js';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import type { Logger as PinoLogger } from 'pino';

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => stubLogger),
} as unknown as PinoLogger;

describe('buildEmbeddingProvider', () => {
  // Reset module-level cache between tests for isolation
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── RED Step 1: Unknown provider throws at construction time (Scenario 3.2) ─

  it('unknown provider throws EmbeddingProviderUnavailableError with reason unknown-provider', () => {
    // RED: buildEmbeddingProvider does not exist yet → this test fails
    expect(() => buildEmbeddingProvider({ provider: 'unknown', logger: stubLogger })).toThrow(
      EmbeddingProviderUnavailableError,
    );
    expect(() => buildEmbeddingProvider({ provider: 'unknown', logger: stubLogger })).toThrow(
      'unknown-provider',
    );
  });

  // ── RED Step 2: gemini without apiKey throws with missing-api-key reason (Scenario 3.3) ─

  it('gemini without apiKey throws EmbeddingProviderUnavailableError with reason missing-api-key', () => {
    // RED: factory not implemented → test fails
    expect(() => buildEmbeddingProvider({ provider: 'gemini', logger: stubLogger })).toThrow(
      EmbeddingProviderUnavailableError,
    );
    expect(() => buildEmbeddingProvider({ provider: 'gemini', logger: stubLogger })).toThrow(
      'missing-api-key',
    );
  });

  // ── TRIANGULATE Step 1: First call with gemini returns a working EmbeddingPort (Scenario 3.1) ─

  it('first call with gemini + apiKey returns an object implementing EmbeddingPort', () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { embedding: { values: Array(768).fill(0.1) } };
      },
    } as unknown as Response);

    const port = buildEmbeddingProvider({
      provider: 'gemini',
      apiKey: 'sk-test',
      logger: stubLogger,
      httpClient: fakeFetch,
    });

    expect(port).toBeDefined();
    expect(typeof port.embed).toBe('function');
    expect(typeof port.embedBatch).toBe('function');
  });

  // ── TRIANGULATE Step 2: Second call constructs a NEW adapter (no singleton by design) ─

  it('second call with same provider constructs a new adapter instance', () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { embedding: { values: Array(768).fill(0.1) } };
      },
    } as unknown as Response);

    const result1 = buildEmbeddingProvider({
      provider: 'gemini',
      apiKey: 'sk-test',
      logger: stubLogger,
      httpClient: fakeFetch,
    });
    const result2 = buildEmbeddingProvider({
      provider: 'gemini',
      apiKey: 'sk-test',
      logger: stubLogger,
      httpClient: fakeFetch,
    });

    // No singleton — two calls produce two distinct instances.
    // Reuse across invocations is the bootstrap's responsibility, not the factory's.
    expect(result1).not.toBe(result2);
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  // ── TRIANGULATE Step 3: Each call constructs a new adapter (one per call) ─

  it('GeminiEmbeddingAdapter constructor is called once per buildEmbeddingProvider call', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { embedding: { values: Array(768).fill(0.1) } };
      },
    } as unknown as Response);

    vi.resetModules();
    let constructionCount = 0;
    vi.doMock('./gemini-adapter.js', () => ({
      GeminiEmbeddingAdapter: class {
        constructor() {
          constructionCount++;
        }
        async embed() {
          return [] as unknown as readonly number[];
        }
        async embedBatch() {
          return [[]] as unknown as readonly (readonly number[])[];
        }
      },
    }));

    const { buildEmbeddingProvider: buildProvider } = await import('./factory.js');

    buildProvider({
      provider: 'gemini',
      apiKey: 'sk-test',
      logger: stubLogger,
      httpClient: fakeFetch,
    });
    buildProvider({
      provider: 'gemini',
      apiKey: 'sk-test',
      logger: stubLogger,
      httpClient: fakeFetch,
    });

    expect(constructionCount).toBe(2);
  });
});

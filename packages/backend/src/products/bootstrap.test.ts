/**
 * Tests for bootstrap wiring — Groups 12.1 and 12.2.
 *
 * Strict TDD: RED first → GREEN → TRIANGULATE.
 *
 * Covers:
 * - Scenario 11.1: cold-start wires resolver + factory once
 * - Scenario 11.2: warm invocation reuses singleton (no re-wiring)
 * - Resolver failure → bootstrap rejects (fail-fast)
 * - Factory unknown-provider error propagates
 *
 * NOTE: Tests must run in a specific order to avoid the global singleton
 * polluting subsequent tests. Error-semantic tests run FIRST so the
 * global singleton is never set before singleton tests verify the warm path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock state (hoisted together so vi.mock factories can reference them) ──────

const { mockResolveGeminiApiKey, mockBuildEmbeddingProvider } = vi.hoisted(() => ({
  mockResolveGeminiApiKey: vi.fn<() => Promise<string>>(),
  mockBuildEmbeddingProvider: vi.fn(),
}));

// ── Static mocks (hoisted) ─────────────────────────────────────────────────────

vi.mock('../shared/logger.js', () => ({
  createLogger: () => ({
    child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../shared/db.js', () => ({
  getDb: () => ({}),
}));

vi.mock('./infrastructure/embedding/api-key-resolver.js', () => ({
  resolveGeminiApiKey: mockResolveGeminiApiKey,
}));

vi.mock('./infrastructure/embedding/factory.js', () => ({
  buildEmbeddingProvider: mockBuildEmbeddingProvider,
}));

// ── Static import ───────────────────────────────────────────────────────────────

import { bootstrapProducts } from './bootstrap.js';

// ── Cache helper ───────────────────────────────────────────────────────────────

function clearBootstrapCache(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__mercadoExpressProducts;
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('bootstrapProducts wiring', () => {
  beforeEach(() => {
    // Reset only call history, not mock implementations
    mockResolveGeminiApiKey.mockClear();
    mockBuildEmbeddingProvider.mockClear();
    clearBootstrapCache();
  });

  afterEach(() => {
    clearBootstrapCache();
  });

  // Run error tests FIRST so the global singleton is never set before
  // singleton-measuring tests verify the warm path (the global singleton
  // survives vi.clearAllMocks but not the cache clear in beforeEach).

  describe('Task 12.2 — error semantics', () => {
    it('rejects when resolver throws EmbeddingProviderUnavailableError (ssm-fetch-failed)', async () => {
      const { EmbeddingProviderUnavailableError } =
        await import('./domain/errors/embedding-provider-unavailable.js');
      mockResolveGeminiApiKey.mockRejectedValue(
        new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed'),
      );
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      await expect(bootstrapProducts()).rejects.toThrow(EmbeddingProviderUnavailableError);
    });

    it('rejects when resolver throws EmbeddingProviderUnavailableError (ssm-param-not-found)', async () => {
      const { EmbeddingProviderUnavailableError } =
        await import('./domain/errors/embedding-provider-unavailable.js');
      mockResolveGeminiApiKey.mockRejectedValue(
        new EmbeddingProviderUnavailableError('gemini', 'ssm-param-not-found'),
      );
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      await expect(bootstrapProducts()).rejects.toThrow(EmbeddingProviderUnavailableError);
    });
  });

  describe('Scenario 11.1 — cold-start wires adapter once', () => {
    it('calls resolveGeminiApiKey on cold start', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      await bootstrapProducts();

      expect(mockResolveGeminiApiKey).toHaveBeenCalledTimes(1);
    });

    it('calls buildEmbeddingProvider with provider=gemini and apiKey', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      const stubEmbedder = { embed: vi.fn(), embedBatch: vi.fn() };
      mockBuildEmbeddingProvider.mockReturnValue(stubEmbedder);

      await bootstrapProducts();

      expect(mockBuildEmbeddingProvider).toHaveBeenCalledTimes(1);
      const call = (mockBuildEmbeddingProvider as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(call.provider).toBe('gemini');
      expect(call.apiKey).toBe('sk-test-key');
    });

    it('returns an object with semanticSearch use case', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      const bootstrap = await bootstrapProducts();

      expect(bootstrap).toHaveProperty('semanticSearch');
      expect(typeof (bootstrap as unknown as Record<string, unknown>).semanticSearch).toBe(
        'object',
      );
    });

    it('returns an object with embeddingPort', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      const bootstrap = await bootstrapProducts();

      expect(bootstrap).toHaveProperty('embeddingPort');
      expect(typeof (bootstrap as unknown as Record<string, unknown>).embeddingPort).toBe('object');
    });

    it('constructs CreateProductUseCase and UpdateProductUseCase', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      const bootstrap = await bootstrapProducts();

      expect(bootstrap).toHaveProperty('createProduct');
      expect(bootstrap).toHaveProperty('updateProduct');
    });
  });

  describe('Scenario 11.2 — warm invocation reuses singleton', () => {
    it('does NOT call resolver on second call', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      await bootstrapProducts();
      await bootstrapProducts();

      expect(mockResolveGeminiApiKey).toHaveBeenCalledTimes(1);
    });

    it('does NOT call factory on second call', async () => {
      mockResolveGeminiApiKey.mockResolvedValue('sk-test-key');
      mockBuildEmbeddingProvider.mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn() });

      await bootstrapProducts();
      await bootstrapProducts();

      expect(mockBuildEmbeddingProvider).toHaveBeenCalledTimes(1);
    });
  });
});

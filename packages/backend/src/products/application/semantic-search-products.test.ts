/**
 * Tests for SemanticSearchUseCase (Group 10).
 *
 * Strict TDD: RED first → GREEN → TRIANGULATE.
 *
 * Covers:
 * - Scenario 9.1: valid query → embed + find + mapped
 * - Scenario 9.2: query < 3 chars → InvalidSemanticSearchQueryError, no embed call
 * - Scenario 9.3: query > 1024 chars → InvalidSemanticSearchQueryError
 * - Scenario 9.4: embedder throws EmbeddingProviderUnavailable → propagates, no repo call
 * - Boundary: 1024 chars is allowed, 1025 is rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticSearchUseCase } from './semantic-search-products.js';
import type { EmbeddingPort } from '../domain/ports/embedding.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';
import { InvalidSemanticSearchQueryError } from '../domain/errors/invalid-semantic-search-query.js';
import { EmbeddingProviderUnavailableError } from '../domain/errors/embedding-provider-unavailable.js';

// ── Stubs ──────────────────────────────────────────────────────────────────────

const STUB_VECTOR: readonly number[] = Object.freeze(
  Array.from({ length: 768 }, (_, i) => i * 0.001),
);

function makeStubEmbeddingPort(overrides: Partial<EmbeddingPort> = {}): EmbeddingPort {
  return {
    embed: vi.fn().mockResolvedValue(STUB_VECTOR),
    embedBatch: vi.fn().mockResolvedValue([STUB_VECTOR]),
    ...overrides,
  };
}

const STUB_PRODUCT_PROPS: ProductProps = {
  id: '00000000-0000-0000-0000-000000000001',
  sku: 'LAPTOP-001',
  name: 'Laptop Gamer',
  description: '16GB RAM, RTX 4060',
  price: 1500000,
  stock: 10,
  stockMin: 5,
  categoryId: '00000000-0000-4000-8000-000000000001',
  supplier: 'ACME Corp',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeStubProductRepository(overrides: Partial<ProductRepository> = {}): ProductRepository {
  return {
    findByEmbedding: vi.fn().mockResolvedValue([STUB_PRODUCT_PROPS]),
    updateEmbedding: vi.fn(),
    findById: vi.fn(),
    findBySku: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('SemanticSearchUseCase', () => {
  let embedder: EmbeddingPort;
  let productRepo: ProductRepository;

  beforeEach(() => {
    embedder = makeStubEmbeddingPort();
    productRepo = makeStubProductRepository();
  });

  describe('Scenario 9.2 — query shorter than 3 chars rejected', () => {
    it('does NOT call embedder for short query', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      await expect(useCase.execute({ query: 'ab', limit: 10 })).rejects.toThrow(
        InvalidSemanticSearchQueryError,
      );
      expect(embedder.embed).not.toHaveBeenCalled();
    });

    it('does NOT call productRepo for short query', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      await expect(useCase.execute({ query: 'ab', limit: 10 })).rejects.toThrow(
        InvalidSemanticSearchQueryError,
      );
      expect(productRepo.findByEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 9.3 — query longer than 1024 chars rejected', () => {
    it('throws InvalidSemanticSearchQueryError for 1025-char query', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const longQuery = 'a'.repeat(1025);
      await expect(useCase.execute({ query: longQuery, limit: 10 })).rejects.toThrow(
        InvalidSemanticSearchQueryError,
      );
    });

    it('does NOT call embedder for long query', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const longQuery = 'a'.repeat(1025);
      await expect(useCase.execute({ query: longQuery, limit: 10 })).rejects.toThrow(
        InvalidSemanticSearchQueryError,
      );
      expect(embedder.embed).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 9.1 — valid query returns similar products', () => {
    it('calls embedder with the query string', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      await useCase.execute({ query: 'laptop gaming', limit: 10 });
      expect(embedder.embed).toHaveBeenCalledTimes(1);
      expect(embedder.embed).toHaveBeenCalledWith('laptop gaming');
    });

    it('calls findByEmbedding with the vector and limit', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      await useCase.execute({ query: 'laptop gaming', limit: 10 });
      expect(productRepo.findByEmbedding).toHaveBeenCalledTimes(1);
      // vector should be a spread of STUB_VECTOR (read-only → writable)
      const [vector, opts] = (productRepo.findByEmbedding as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(vector).toHaveLength(768);
      expect(opts).toEqual({ limit: 10 });
    });

    it('returns { items: Product[], total: number }', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const result = await useCase.execute({ query: 'laptop gaming', limit: 10 });
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('total equals items.length', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const result = await useCase.execute({ query: 'laptop gaming', limit: 10 });
      expect(result.total).toBe(result.items.length);
    });

    it('items are rehydrated Product aggregates', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const result = await useCase.execute({ query: 'laptop gaming', limit: 10 });
      expect(result.items.length).toBeGreaterThan(0);
      // Product aggregates expose .toReadModel()
      expect(typeof result.items[0].toReadModel).toBe('function');
    });
  });

  describe('Scenario 9.4 — embedder failure propagates verbatim', () => {
    it('EmbeddingProviderUnavailableError propagates without wrapping', async () => {
      const innerError = new EmbeddingProviderUnavailableError('gemini', 'HTTP 500');
      embedder = makeStubEmbeddingPort({
        embed: vi.fn().mockRejectedValue(innerError),
      });
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      await expect(useCase.execute({ query: 'laptop', limit: 5 })).rejects.toThrow(
        EmbeddingProviderUnavailableError,
      );
      // Should be the exact same error reference, not a new one
      await expect(useCase.execute({ query: 'laptop', limit: 5 })).rejects.toThrow(innerError);
    });

    it('productRepo.findByEmbedding is NOT called when embedder throws', async () => {
      const innerError = new EmbeddingProviderUnavailableError('gemini', 'HTTP 500');
      embedder = makeStubEmbeddingPort({
        embed: vi.fn().mockRejectedValue(innerError),
      });
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      await expect(useCase.execute({ query: 'laptop', limit: 5 })).rejects.toThrow(
        EmbeddingProviderUnavailableError,
      );
      expect(productRepo.findByEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('Boundary — 1024 chars allowed, 1025 rejected', () => {
    it('accepts query of exactly 1024 characters', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const exactQuery = 'x'.repeat(1024);
      const result = await useCase.execute({ query: exactQuery, limit: 10 });
      expect(result).toHaveProperty('items');
      expect(embedder.embed).toHaveBeenCalledWith(exactQuery);
    });

    it('rejects query of exactly 1025 characters', async () => {
      const useCase = new SemanticSearchUseCase(embedder, productRepo);
      const overQuery = 'x'.repeat(1025);
      await expect(useCase.execute({ query: overQuery, limit: 10 })).rejects.toThrow(
        InvalidSemanticSearchQueryError,
      );
      expect(embedder.embed).not.toHaveBeenCalled();
    });
  });
});

/**
 * Tests for UpdateProductUseCase embedding integration.
 * Verifies selective re-embed on text-field changes (name, description, supplier).
 *
 * Strict TDD: RED → GREEN → TRIANGULATE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UpdateProductUseCase } from './update-product.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';
import type { EmbeddingPort } from '../domain/ports/embedding.js';
import type { Logger as PinoLogger } from 'pino';

const ID = '11111111-1111-4111-8111-111111111111';
const CAT = '00000000-0000-4000-8000-000000000001';

const ROW: ProductProps = {
  id: ID,
  sku: 'BEB-001',
  name: 'Agua Mineral 500ml',
  categoryId: CAT,
  price: 1500,
  stock: 100,
  stockMin: 50,
  supplier: 'Distribuidora Andina',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeRepos(
  opts: {
    existing?: ProductProps | null;
    hasActiveAlert?: boolean;
  } = {},
): {
  products: ProductRepository;
  categories: CategoryReadRepository;
  alertReadModel: AlertReadModelPort;
} {
  const products: ProductRepository = {
    async findById(id: string) {
      if (!opts.existing) return null;
      return opts.existing.id === id ? opts.existing : null;
    },
    async findBySku() {
      return null;
    },
    async create(p) {
      return p;
    },
    async update(_id: string, patch: Partial<ProductProps>) {
      return { ...ROW, ...patch, updatedAt: new Date() } as ProductProps;
    },
    async list() {
      return { items: [], page: 1, size: 20, total: 0, hasMore: false };
    },
    async findByEmbedding(_embedding, _opts) {
      return [];
    },
    updateEmbedding: vi.fn(async (_id: string, _embedding: number[]) => {}),
  };
  const categories: CategoryReadRepository = {
    async findById(id: string) {
      if (id === CAT) return { id: CAT, name: 'Bebidas', active: true };
      return null;
    },
    async list() {
      return [];
    },
  };
  const alertReadModel: AlertReadModelPort = {
    async findProductIdsWithActiveAlert() {
      return [];
    },
    async hasActiveAlert() {
      return opts.hasActiveAlert ?? false;
    },
  };
  return { products, categories, alertReadModel };
}

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => stubLogger),
} as unknown as PinoLogger;

describe('UpdateProductUseCase — embedding integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Scenario 8.1: name change → setImmediate fires ──────────────────────────

  it('text-field change (name) schedules embed via setImmediate', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockResolvedValue(Array(768).fill(0.42) as unknown as readonly number[]),
    } as unknown as EmbeddingPort;
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = UpdateProductUseCase;
    const useCase = new UseCaseAny(products, categories, alertReadModel, stubEmbedder, stubLogger);

    const p = useCase.execute(ID, { name: 'New Product Name' });
    await vi.runAllTimersAsync();
    await p;

    expect(stubEmbedder.embed).toHaveBeenCalledOnce();
    // description is undefined → '', so text = 'New Product Name  Distribuidora Andina'
    expect(stubEmbedder.embed).toHaveBeenCalledWith('New Product Name  Distribuidora Andina');
    expect(products.updateEmbedding).toHaveBeenCalledOnce();
  });

  // ── Scenario 8.1 variant: description change → setImmediate fires ─────────────

  it('text-field change (description) schedules embed via setImmediate', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockResolvedValue(Array(768).fill(0.99) as unknown as readonly number[]),
    } as unknown as EmbeddingPort;
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = UpdateProductUseCase;
    const useCase = new UseCaseAny(products, categories, alertReadModel, stubEmbedder, stubLogger);

    const p = useCase.execute(ID, { description: 'Premium water brand' });
    await vi.runAllTimersAsync();
    await p;

    expect(stubEmbedder.embed).toHaveBeenCalledOnce();
    // text = name + ' ' + description + ' ' + supplier (single spaces throughout)
    expect(stubEmbedder.embed).toHaveBeenCalledWith(
      'Agua Mineral 500ml Premium water brand Distribuidora Andina',
    );
    expect(products.updateEmbedding).toHaveBeenCalledOnce();
  });

  // ── Scenario 8.2: stock-only change → setImmediate NOT fired ─────────────────

  it('stock-only change does NOT schedule embed', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockResolvedValue(Array(768).fill(0.42) as unknown as readonly number[]),
    } as unknown as EmbeddingPort;
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = UpdateProductUseCase;
    const useCase = new UseCaseAny(products, categories, alertReadModel, stubEmbedder, stubLogger);

    const p = useCase.execute(ID, { stockMin: 150 });
    await vi.runAllTimersAsync();
    await p;

    expect(stubEmbedder.embed).not.toHaveBeenCalled();
    expect(products.updateEmbedding).not.toHaveBeenCalled();
  });

  // ── Scenario 8.2 variant: price-only change → setImmediate NOT fired ──────────

  it('price-only change does NOT schedule embed', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockResolvedValue(Array(768).fill(0.42) as unknown as readonly number[]),
    } as unknown as EmbeddingPort;
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = UpdateProductUseCase;
    const useCase = new UseCaseAny(products, categories, alertReadModel, stubEmbedder, stubLogger);

    const p = useCase.execute(ID, { price: 2000 });
    await vi.runAllTimersAsync();
    await p;

    expect(stubEmbedder.embed).not.toHaveBeenCalled();
  });

  // ── No embedder: setImmediate NOT fired regardless of input ───────────────────

  it('no embedder injected → embed never called even on text-field change', async () => {
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);

    const p = useCase.execute(ID, { name: 'Another Name', supplier: 'New Supplier' });
    await vi.runAllTimersAsync();
    await p;

    // No embedder, so updateEmbedding should not be called
    expect(products.updateEmbedding).not.toHaveBeenCalled();
  });

  // ── Scenario 8.3: fail-open — embedder throws but execute still resolves ───────

  it('execute() resolves even when embedder throws; updateEmbedding NOT called; warning logged', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockRejectedValue(new Error('API down')),
    } as unknown as EmbeddingPort;
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = UpdateProductUseCase;
    const useCase = new UseCaseAny(products, categories, alertReadModel, stubEmbedder, stubLogger);

    const p = useCase.execute(ID, { name: 'Updated Name' });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeDefined();

    expect(products.updateEmbedding).not.toHaveBeenCalled();
    expect(stubLogger.warn).toHaveBeenCalledOnce();
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stubLogger.warn as any).mock.calls[0]![0],
    ).toMatchObject({
      productId: ID,
      provider: 'gemini',
      outcome: 'exhausted',
    });
  });

  // ── Edge case: empty-string name still triggers re-embed ──────────────────────

  it('empty-string name is present (not undefined) → re-embed is scheduled', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockResolvedValue(Array(768).fill(0.1) as unknown as readonly number[]),
    } as unknown as EmbeddingPort;
    const { products, categories, alertReadModel } = makeRepos({ existing: ROW });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = UpdateProductUseCase;
    const useCase = new UseCaseAny(products, categories, alertReadModel, stubEmbedder, stubLogger);

    const p = useCase.execute(ID, { name: '' });
    await vi.runAllTimersAsync();
    await p;

    // name: '' is present (not undefined) → should trigger re-embed
    expect(stubEmbedder.embed).toHaveBeenCalledOnce();
  });
});

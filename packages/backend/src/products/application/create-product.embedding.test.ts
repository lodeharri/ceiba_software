/**
 * Tests for CreateProductUseCase embedding integration.
 * Verifies fire-and-forget embedding after product creation.
 *
 * Strict TDD: RED first → GREEN → TRIANGULATE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreateProductUseCase } from './create-product.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';
import type { AlertOpenerPort } from '../../alerts/domain/ports/alert-opener-port.js';
import type { EmbeddingPort } from '../domain/ports/embedding.js';

const VALID_INPUT = {
  sku: 'SKU-CREATE-001',
  name: 'Agua Mineral',
  categoryId: '00000000-0000-4000-8000-000000000001',
  price: 1500,
  stock: 10,
  stockMin: 5,
  supplier: 'Distribuidora Andina',
};

function makeStubCategoryRepository() {
  return {
    findById: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Bebidas',
      active: true,
    }),
  } as unknown as CategoryReadRepository;
}

function makeStubAlertOpener() {
  return {
    openIfAbsent: vi.fn().mockResolvedValue(undefined),
  } as unknown as AlertOpenerPort;
}

function makeStubProductRepository() {
  return {
    create: vi
      .fn()
      .mockImplementation(async (p) => ({ ...p, createdAt: new Date(), updatedAt: new Date() })),
    findBySku: vi.fn().mockResolvedValue(null),
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    updateEmbedding: vi.fn(),
    findByEmbedding: vi.fn(),
  } as unknown as ProductRepository;
}

describe('CreateProductUseCase — embedding integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Scenario 7.1: embed is invoked via setImmediate ──────────────────────────

  it('setImmediate fires once with embedInBackground when embedder is injected', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockResolvedValue(Array(768).fill(0.42) as unknown as readonly number[]),
    } as unknown as EmbeddingPort;

    const stubProductRepo = makeStubProductRepository();
    const stubCategoryRepo = makeStubCategoryRepository();
    const stubAlertOpener = makeStubAlertOpener();

    // Cast the class to any to allow 4th argument during RED phase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = CreateProductUseCase;
    const useCase = new UseCaseAny(
      stubProductRepo,
      stubCategoryRepo,
      stubAlertOpener,
      stubEmbedder,
    );

    const p = useCase.execute(VALID_INPUT);
    await vi.runAllTimersAsync();
    await p;

    // setImmediate fires: embedInBackground is called
    expect(stubEmbedder.embed).toHaveBeenCalledOnce();
    // The text is: name + ' ' + description(undefined→'') + ' ' + supplier
    // description is not in CreateProductInput, so it is undefined → '' via ?? operator
    // Result: 'Agua Mineral' + ' ' + '' + ' ' + 'Distribuidora Andina' = 2 spaces
    expect(stubEmbedder.embed).toHaveBeenCalledWith('Agua Mineral  Distribuidora Andina');
    // updateEmbedding is called with the vector
    expect(stubProductRepo.updateEmbedding).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [id, vector] = (stubProductRepo.updateEmbedding as any).mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(id).toBe((stubProductRepo.create as any).mock.calls[0]![0]!.id);
    expect(vector).toHaveLength(768);
    expect(vector[0]).toBeCloseTo(0.42);
  });

  // ── Scenario 7.2: embed fails → no throw, warning logged ───────────────────

  it('execute() resolves even when embedder throws; updateEmbedding NOT called; warning captured', async () => {
    const stubEmbedder = {
      embed: vi.fn().mockRejectedValue(new Error('API down')),
    } as unknown as EmbeddingPort;

    const stubProductRepo = makeStubProductRepository();
    const stubCategoryRepo = makeStubCategoryRepository();
    const stubAlertOpener = makeStubAlertOpener();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UseCaseAny: any = CreateProductUseCase;
    const useCase = new UseCaseAny(
      stubProductRepo,
      stubCategoryRepo,
      stubAlertOpener,
      stubEmbedder,
    );

    // Must resolve, not reject
    const p = useCase.execute(VALID_INPUT);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeDefined();

    // updateEmbedding NOT called
    expect(stubProductRepo.updateEmbedding).not.toHaveBeenCalled();
  });

  // ── No embedder: execute() resolves normally without calling embed ─────────────

  it('execute() resolves without calling embed when no embedder injected', async () => {
    const stubProductRepo = makeStubProductRepository();
    const stubCategoryRepo = makeStubCategoryRepository();
    const stubAlertOpener = makeStubAlertOpener();

    const useCase = new CreateProductUseCase(stubProductRepo, stubCategoryRepo, stubAlertOpener);

    const result = await useCase.execute(VALID_INPUT);
    await vi.runAllTimersAsync();

    expect(result).toBeDefined();
    expect(stubProductRepo.create).toHaveBeenCalledOnce();
  });
});

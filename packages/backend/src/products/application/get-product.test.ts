import { describe, expect, it } from 'vitest';
import { GetProductUseCase } from './get-product.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';

const ID = '11111111-1111-4111-8111-111111111111';

function makeRepo(opts: { found?: ProductProps | null } = {}): ProductRepository {
  const store = { found: opts.found ?? null };
  return {
    async findById(id: string) {
      if (!store.found) return null;
      return store.found.id === id ? store.found : null;
    },
    async findBySku() {
      return null;
    },
    async create(p) {
      return p;
    },
    async update() {
      throw new Error('not used');
    },
    async list() {
      return { items: [], page: 1, size: 20, total: 0, hasMore: false };
    },
  };
}

const ROW: ProductProps = {
  id: ID,
  sku: 'BEB-001',
  name: 'Agua Mineral 500ml',
  categoryId: '00000000-0000-4000-8000-000000000001',
  price: 1500,
  stock: 100,
  stockMin: 50,
  supplier: 'Distribuidora Andina',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('GetProductUseCase', () => {
  it('returns a hydrated product on hit', async () => {
    const repo = makeRepo({ found: ROW });
    const useCase = new GetProductUseCase(repo);
    const product = await useCase.execute(ID);
    expect(product.id).toBe(ID);
    expect(product.sku).toBe('BEB-001');
    expect(product.price).toBe(1500);
    expect(product.createdAt).toBeInstanceOf(Date);
  });

  it('throws ProductNotFoundError when no row matches', async () => {
    const repo = makeRepo({ found: null });
    const useCase = new GetProductUseCase(repo);
    await expect(useCase.execute(ID)).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('uppercases sku and trims name (rehydrate invariants)', async () => {
    const repo = makeRepo({
      found: { ...ROW, sku: 'beb-001', name: '  Agua Mineral 500ml  ' },
    });
    const useCase = new GetProductUseCase(repo);
    const product = await useCase.execute(ID);
    expect(product.sku).toBe('BEB-001');
    expect(product.name).toBe('Agua Mineral 500ml');
  });
});
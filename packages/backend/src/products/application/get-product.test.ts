import { describe, expect, it } from 'vitest';
import { GetProductUseCase } from './get-product.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';

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

function makeAlertReadModel(hasActive = false): AlertReadModelPort {
  return {
    async findProductIdsWithActiveAlert() {
      return [];
    },
    async hasActiveAlert() {
      return hasActive;
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
    const useCase = new GetProductUseCase(repo, makeAlertReadModel());
    const product = await useCase.execute(ID);
    expect(product.id).toBe(ID);
    expect(product.sku).toBe('BEB-001');
    expect(product.price).toBe(1500);
    expect(product.createdAt).toBeInstanceOf(Date);
  });

  it('throws ProductNotFoundError when no row matches', async () => {
    const repo = makeRepo({ found: null });
    const useCase = new GetProductUseCase(repo, makeAlertReadModel());
    await expect(useCase.execute(ID)).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('uppercases sku and trims name (rehydrate invariants)', async () => {
    const repo = makeRepo({
      found: { ...ROW, sku: 'beb-001', name: '  Agua Mineral 500ml  ' },
    });
    const useCase = new GetProductUseCase(repo, makeAlertReadModel());
    const product = await useCase.execute(ID);
    expect(product.sku).toBe('BEB-001');
    expect(product.name).toBe('Agua Mineral 500ml');
  });

  it('attaches hasActiveAlert=false when the product has no active alert', async () => {
    const repo = makeRepo({ found: ROW });
    const useCase = new GetProductUseCase(repo, makeAlertReadModel(false));
    const product = await useCase.execute(ID);
    expect(product.toReadModel().hasActiveAlert).toBe(false);
  });

  it('attaches hasActiveAlert=true when the alerts port reports an active alert', async () => {
    const repo = makeRepo({ found: ROW });
    const useCase = new GetProductUseCase(repo, makeAlertReadModel(true));
    const product = await useCase.execute(ID);
    expect(product.toReadModel().hasActiveAlert).toBe(true);
  });

  it('does not call the alerts port when the product does not exist', async () => {
    const repo = makeRepo({ found: null });
    let alertCalls = 0;
    const alertReadModel: AlertReadModelPort = {
      async findProductIdsWithActiveAlert() {
        return [];
      },
      async hasActiveAlert() {
        alertCalls += 1;
        return false;
      },
    };
    const useCase = new GetProductUseCase(repo, alertReadModel);
    await expect(useCase.execute(ID)).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(alertCalls).toBe(0);
  });
});

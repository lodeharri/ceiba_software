import { describe, expect, it } from 'vitest';
import { UpdateProductUseCase, type UpdateProductInput } from './update-product.js';
import { CategoryNotFoundError } from '../domain/errors/category-not-found.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CAT = '00000000-0000-4000-8000-000000000001';
const CAT2 = '00000000-0000-4000-8000-000000000002';

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
    existingCategory?: { id: string; name: string } | null;
    secondCategory?: { id: string; name: string } | null;
    hasActiveAlert?: boolean;
  } = {},
): {
  products: ProductRepository;
  categories: CategoryReadRepository;
  alertReadModel: AlertReadModelPort;
  updatedCalls: Array<{ id: string; patch: UpdateProductInput }>;
} {
  const updatedCalls: Array<{ id: string; patch: UpdateProductInput }> = [];
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
    async update(id: string, patch: Partial<ProductProps>) {
      updatedCalls.push({ id, patch });
      return { ...ROW, ...patch, updatedAt: new Date() } as ProductProps;
    },
    async list() {
      return { items: [], page: 1, size: 20, total: 0, hasMore: false };
    },
    async findByEmbedding(_embedding, _opts) {
      return [];
    },
    async updateEmbedding(_id, _embedding) {},
  };
  const categories: CategoryReadRepository = {
    async findById(id: string) {
      if (opts.existingCategory && opts.existingCategory.id === id) {
        return opts.existingCategory;
      }
      if (opts.secondCategory && opts.secondCategory.id === id) {
        return opts.secondCategory;
      }
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
  return { products, categories, alertReadModel, updatedCalls };
}

describe('UpdateProductUseCase', () => {
  it('updates editable fields and persists', async () => {
    const { products, categories, alertReadModel, updatedCalls } = makeRepos({
      existing: ROW,
      secondCategory: { id: CAT2, name: 'Snacks' },
    });
    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);
    const result = await useCase.execute(ID, {
      name: 'Agua Mineral 1L',
      supplier: 'Otro Proveedor',
      price: 1800,
      stockMin: 60,
      categoryId: CAT2,
    });
    expect(result.name).toBe('Agua Mineral 1L');
    expect(result.price).toBe(1800);
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0]!.id).toBe(ID);
    expect(updatedCalls[0]!.patch).toMatchObject({
      name: 'Agua Mineral 1L',
      supplier: 'Otro Proveedor',
      price: 1800,
      stockMin: 60,
      categoryId: CAT2,
    });
  });

  it('skips category validation when categoryId is omitted', async () => {
    const { products, categories, alertReadModel, updatedCalls } = makeRepos({ existing: ROW });
    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);
    await useCase.execute(ID, { name: 'Agua Mineral 500ml Plus' });
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0]!.patch).not.toHaveProperty('categoryId');
  });

  it('throws ProductNotFoundError when the product does not exist', async () => {
    const { products, categories, alertReadModel } = makeRepos({ existing: null });
    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);
    await expect(useCase.execute(ID, { name: 'x' })).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('throws CategoryNotFoundError when categoryId does not exist', async () => {
    const { products, categories, alertReadModel } = makeRepos({
      existing: ROW,
      secondCategory: null,
    });
    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);
    await expect(useCase.execute(ID, { categoryId: CAT2 })).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });

  it('attaches hasActiveAlert=false to the returned read model when no alert', async () => {
    const { products, categories, alertReadModel } = makeRepos({
      existing: ROW,
      secondCategory: { id: CAT2, name: 'Snacks' },
      hasActiveAlert: false,
    });
    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);
    const result = await useCase.execute(ID, { name: 'Renamed' });
    expect(result.toReadModel().hasActiveAlert).toBe(false);
  });

  it('attaches hasActiveAlert=true to the returned read model when the alerts port reports an active alert', async () => {
    const { products, categories, alertReadModel } = makeRepos({
      existing: ROW,
      hasActiveAlert: true,
    });
    const useCase = new UpdateProductUseCase(products, categories, alertReadModel);
    const result = await useCase.execute(ID, { name: 'Renamed' });
    expect(result.toReadModel().hasActiveAlert).toBe(true);
  });
});

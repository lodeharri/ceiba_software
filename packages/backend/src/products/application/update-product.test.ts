import { describe, expect, it } from 'vitest';
import { UpdateProductUseCase, type UpdateProductInput } from './update-product.js';
import { CategoryNotFoundError } from '../domain/errors/category-not-found.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';

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
  } = {},
): {
  products: ProductRepository;
  categories: CategoryReadRepository;
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
  return { products, categories, updatedCalls };
}

describe('UpdateProductUseCase', () => {
  it('updates editable fields and persists', async () => {
    const { products, categories, updatedCalls } = makeRepos({
      existing: ROW,
      secondCategory: { id: CAT2, name: 'Snacks' },
    });
    const useCase = new UpdateProductUseCase(products, categories);
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
    const { products, categories, updatedCalls } = makeRepos({ existing: ROW });
    const useCase = new UpdateProductUseCase(products, categories);
    await useCase.execute(ID, { name: 'Agua Mineral 500ml Plus' });
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0]!.patch).not.toHaveProperty('categoryId');
  });

  it('throws ProductNotFoundError when the product does not exist', async () => {
    const { products, categories } = makeRepos({ existing: null });
    const useCase = new UpdateProductUseCase(products, categories);
    await expect(useCase.execute(ID, { name: 'x' })).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('throws CategoryNotFoundError when categoryId does not exist', async () => {
    const { products, categories } = makeRepos({
      existing: ROW,
      secondCategory: null,
    });
    const useCase = new UpdateProductUseCase(products, categories);
    await expect(useCase.execute(ID, { categoryId: CAT2 })).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });
});

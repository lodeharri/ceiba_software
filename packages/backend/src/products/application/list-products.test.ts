import { describe, expect, it } from 'vitest';
import { ListProductsUseCase, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './list-products.js';
import type { ProductRepository, ProductProps, Page } from '../domain/ports/product-repository.js';

const CAT = '00000000-0000-4000-8000-000000000001';
function makeProducts(rows: ProductProps[]): ProductRepository {
  return {
    async findById() {
      return null;
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
    async list({ filters, page, size }): Promise<Page<ProductProps>> {
      let items = rows;
      if (filters?.categoryId) items = items.filter((r) => r.categoryId === filters.categoryId);
      if (filters?.supplier) items = items.filter((r) => r.supplier.includes(filters.supplier!));
      const total = items.length;
      const start = (page - 1) * size;
      const slice = items.slice(start, start + size);
      return { items: slice, page, size, total, hasMore: start + size < total };
    },
  };
}

describe('ListProductsUseCase', () => {
  const rows: ProductProps[] = Array.from({ length: 25 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    sku: `SKU-${String(i).padStart(4, '0')}`,
    name: `Product ${i}`,
    categoryId: i % 2 === 0 ? CAT : '00000000-0000-4000-8000-000000000002',
    price: 1000 + i,
    stock: i * 10,
    stockMin: 5,
    supplier: i % 3 === 0 ? 'Distribuidora Andina' : 'Other Supplier',
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  it('returns default page+size when no params supplied', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo);
    const result = await useCase.execute();
    expect(result.page).toBe(1);
    expect(result.size).toBe(DEFAULT_PAGE_SIZE);
    expect(result.items.length).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it('caps size at MAX_PAGE_SIZE', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo);
    const result = await useCase.execute({ page: 1, size: 9999 });
    expect(result.size).toBe(MAX_PAGE_SIZE);
  });

  it('filters by categoryId', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo);
    const result = await useCase.execute({ filters: { categoryId: CAT } });
    expect(result.items.length).toBe(13); // half of 25 = 12 + 1 (rows 0,2,4,...,24)
    expect(result.items.every((p) => p.categoryId === CAT)).toBe(true);
  });

  it('paginates', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo);
    const p1 = await useCase.execute({ page: 1, size: 10 });
    const p2 = await useCase.execute({ page: 2, size: 10 });
    expect(p1.items[0]!.id).not.toBe(p2.items[0]!.id);
    expect(p1.hasMore).toBe(true);
    expect(p2.items.length).toBe(10);
  });
});

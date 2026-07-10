import { describe, expect, it, vi } from 'vitest';
import { ListProductsUseCase, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './list-products.js';
import type {
  ProductRepository,
  ProductProps,
  Page,
  ListOptions,
} from '../domain/ports/product-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';

const CAT = '00000000-0000-4000-8000-000000000001';
function row(id: string, supplier = 'Other Supplier'): ProductProps {
  return {
    id,
    sku: `SKU-${id.slice(-4)}`,
    name: `Product ${id.slice(-4)}`,
    categoryId: CAT,
    price: 1000,
    stock: 10,
    stockMin: 5,
    supplier,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeProducts(
  rows: ProductProps[],
  captured: { lastListOptions?: ListOptions } = {},
): ProductRepository {
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
    async list({ filters, page, size, productIds }: ListOptions): Promise<Page<ProductProps>> {
      captured.lastListOptions = { filters, page, size, productIds };
      let items = rows;
      if (filters?.categoryId) items = items.filter((r) => r.categoryId === filters.categoryId);
      if (filters?.supplier) items = items.filter((r) => r.supplier.includes(filters.supplier!));
      if (productIds !== undefined) {
        const set = new Set(productIds);
        items = items.filter((r) => set.has(r.id));
      }
      const total = items.length;
      const start = (page - 1) * size;
      const slice = items.slice(start, start + size);
      return { items: slice, page, size, total, hasMore: start + size < total };
    },
  };
}

function makeAlertReadModel(activeProductIds: readonly string[]): AlertReadModelPort {
  return {
    async findProductIdsWithActiveAlert() {
      return activeProductIds;
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
    const useCase = new ListProductsUseCase(repo, makeAlertReadModel([]));
    const result = await useCase.execute();
    expect(result.page).toBe(1);
    expect(result.size).toBe(DEFAULT_PAGE_SIZE);
    expect(result.items.length).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it('caps size at MAX_PAGE_SIZE', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo, makeAlertReadModel([]));
    const result = await useCase.execute({ page: 1, size: 9999 });
    expect(result.size).toBe(MAX_PAGE_SIZE);
  });

  it('filters by categoryId', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo, makeAlertReadModel([]));
    const result = await useCase.execute({ filters: { categoryId: CAT } });
    expect(result.items.length).toBe(13); // half of 25 = 12 + 1 (rows 0,2,4,...,24)
    expect(result.items.every((p) => p.categoryId === CAT)).toBe(true);
  });

  it('paginates', async () => {
    const repo = makeProducts(rows);
    const useCase = new ListProductsUseCase(repo, makeAlertReadModel([]));
    const p1 = await useCase.execute({ page: 1, size: 10 });
    const p2 = await useCase.execute({ page: 2, size: 10 });
    expect(p1.items[0]!.id).not.toBe(p2.items[0]!.id);
    expect(p1.hasMore).toBe(true);
    expect(p2.items.length).toBe(10);
  });

  // KL-13: hasActiveAlert filter -------------------------------------------------
  const ROWS: ProductProps[] = [
    row('00000000-0000-4000-8000-000000000a01'),
    row('00000000-0000-4000-8000-000000000a02'),
    row('00000000-0000-4000-8000-000000000a03'),
  ];

  it('hasActiveAlert=true narrows to products with an active alert', async () => {
    const portSpy = vi.fn(async () => [
      '00000000-0000-4000-8000-000000000a01',
      '00000000-0000-4000-8000-000000000a03',
    ]);
    const captured: { lastListOptions?: ListOptions } = {};
    const useCase = new ListProductsUseCase(makeProducts(ROWS, captured), {
      findProductIdsWithActiveAlert: portSpy,
    });
    const result = await useCase.execute({ filters: { hasActiveAlert: true } });
    expect(portSpy).toHaveBeenCalledTimes(1);
    expect(captured.lastListOptions?.productIds).toEqual([
      '00000000-0000-4000-8000-000000000a01',
      '00000000-0000-4000-8000-000000000a03',
    ]);
    expect(result.items.map((p) => p.id)).toEqual([
      '00000000-0000-4000-8000-000000000a01',
      '00000000-0000-4000-8000-000000000a03',
    ]);
  });

  it('hasActiveAlert=true returns empty when no product has an active alert', async () => {
    const useCase = new ListProductsUseCase(makeProducts(ROWS), {
      findProductIdsWithActiveAlert: async () => [],
    });
    const result = await useCase.execute({ filters: { hasActiveAlert: true } });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('hasActiveAlert=true composes with categoryId (KL-13 triangulate)', async () => {
    const customRows: ProductProps[] = [
      { ...row('00000000-0000-4000-8000-000000000b01'), categoryId: CAT },
      {
        ...row('00000000-0000-4000-8000-000000000b02'),
        categoryId: '00000000-0000-4000-8000-000000000002',
      },
    ];
    const useCase = new ListProductsUseCase(makeProducts(customRows), {
      findProductIdsWithActiveAlert: async () => [
        '00000000-0000-4000-8000-000000000b01',
        '00000000-0000-4000-8000-000000000b02',
      ],
    });
    const result = await useCase.execute({
      filters: { hasActiveAlert: true, categoryId: CAT },
    });
    expect(result.items.map((p) => p.id)).toEqual(['00000000-0000-4000-8000-000000000b01']);
  });

  it('hasActiveAlert=undefined does NOT call the alert port (backward compat)', async () => {
    const portSpy = vi.fn(async () => []);
    const captured: { lastListOptions?: ListOptions } = {};
    const useCase = new ListProductsUseCase(makeProducts(ROWS, captured), {
      findProductIdsWithActiveAlert: portSpy,
    });
    const result = await useCase.execute({ filters: {} });
    expect(portSpy).not.toHaveBeenCalled();
    expect(captured.lastListOptions?.productIds).toBeUndefined();
    expect(result.items.length).toBe(3);
  });

  it('hasActiveAlert=false does NOT call the alert port (backward compat per spec)', async () => {
    const portSpy = vi.fn(async () => []);
    const useCase = new ListProductsUseCase(makeProducts(ROWS), {
      findProductIdsWithActiveAlert: portSpy,
    });
    const result = await useCase.execute({ filters: { hasActiveAlert: false } });
    expect(portSpy).not.toHaveBeenCalled();
    expect(result.items.length).toBe(3);
  });
});

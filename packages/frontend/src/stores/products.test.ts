/**
 * Unit tests for the products Pinia store.
 *
 * Covers the public surface:
 *  - initial empty state
 *  - fetchList — action that mutates items / total / page / size
 *  - create — action that prepends to items and increments total
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/services/products', () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

import { useProductsStore } from './products';
import * as svc from '@/services/products';

const mockedList = vi.mocked(svc.listProducts);
const mockedCreate = vi.mocked(svc.createProduct);

describe('useProductsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedList.mockReset();
    mockedCreate.mockReset();
  });

  it('starts with empty items, no current, and loading=false / error=null', () => {
    const store = useProductsStore();

    expect(store.items).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.page).toBe(1);
    expect(store.size).toBe(20);
    expect(store.current).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchList populates items/total/page/size from the service response', async () => {
    const store = useProductsStore();
    mockedList.mockResolvedValue({
      items: [{ id: 'p-1', sku: 'SKU-1', name: 'Coca' } as never],
      total: 1,
      page: 2,
      size: 10,
    });

    await store.fetchList({ page: 2, size: 10 });

    expect(store.items).toHaveLength(1);
    expect(store.total).toBe(1);
    expect(store.page).toBe(2);
    expect(store.size).toBe(10);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('create() prepends the new product to items and increments total', async () => {
    const store = useProductsStore();
    store.items = [{ id: 'p-1', sku: 'SKU-1', name: 'Old' } as never];
    store.total = 1;
    mockedCreate.mockResolvedValue({ id: 'p-2', sku: 'SKU-2', name: 'New' } as never);

    const result = await store.create({
      sku: 'SKU-2',
      name: 'New',
      categoryId: 'c-1',
      unitPrice: 1.5,
      minStock: 0,
      initialStock: 0,
    });

    expect(result).toMatchObject({ id: 'p-2' });
    expect(store.items.map((p) => p.id)).toEqual(['p-2', 'p-1']);
    expect(store.total).toBe(2);
  });
});

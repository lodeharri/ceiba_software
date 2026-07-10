/**
 * Unit tests for the orders Pinia store.
 *
 * Covers:
 *  - initial empty state
 *  - fetchList — populates items/total/page and updates statusFilter
 *  - create — prepends to items and increments total (mutation)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/services/orders', () => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  createOrder: vi.fn(),
  approveOrder: vi.fn(),
  rejectOrder: vi.fn(),
  receiveOrder: vi.fn(),
}));

import { useOrdersStore } from './orders';
import * as svc from '@/services/orders';

const mockedList = vi.mocked(svc.listOrders);
const mockedCreate = vi.mocked(svc.createOrder);

describe('useOrdersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedList.mockReset();
    mockedCreate.mockReset();
  });

  it('starts with empty items, no current, no status filter and loading=false', () => {
    const store = useOrdersStore();

    expect(store.items).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.page).toBe(1);
    expect(store.current).toBeNull();
    expect(store.statusFilter).toBeUndefined();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchList populates items/total/page and tracks the status filter', async () => {
    const store = useOrdersStore();
    mockedList.mockResolvedValue({
      items: [{ id: 'o-1', status: 'PENDING' } as never],
      total: 1,
      page: 1,
      size: 20,
    });

    await store.fetchList({ status: 'PENDING' });

    expect(store.items).toHaveLength(1);
    expect(store.total).toBe(1);
    expect(store.statusFilter).toBe('PENDING');
  });

  it('create() prepends the new order to items and increments total', async () => {
    const store = useOrdersStore();
    store.items = [{ id: 'o-1', status: 'PENDING' } as never];
    store.total = 1;
    mockedCreate.mockResolvedValue({ id: 'o-2', status: 'PENDING' } as never);

    const result = await store.create({
      supplierId: 's-1',
      lines: [{ productId: 'p-1', quantity: 5 }],
    });

    expect(result).toMatchObject({ id: 'o-2' });
    expect(store.items.map((o) => o.id)).toEqual(['o-2', 'o-1']);
    expect(store.total).toBe(2);
  });
});

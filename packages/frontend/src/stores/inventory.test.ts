/**
 * Unit tests for the inventory Pinia store.
 *
 * Covers:
 *  - initial empty state
 *  - fetchMovements — keyed by productId (RISK-N04)
 *  - recordMovement — prepends into the product's bucket
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/services/inventory', () => ({
  listMovements: vi.fn(),
  recordMovement: vi.fn(),
}));

import { useInventoryStore } from './inventory';
import * as svc from '@/services/inventory';

const mockedList = vi.mocked(svc.listMovements);
const mockedRecord = vi.mocked(svc.recordMovement);

describe('useInventoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedList.mockReset();
    mockedRecord.mockReset();
  });

  it('starts with no movements, loading=false and error=null', () => {
    const store = useInventoryStore();

    expect(store.movementsByProduct.size).toBe(0);
    expect(store.currentTotal).toBe(0);
    expect(store.currentPage).toBe(1);
    expect(store.currentSize).toBe(50);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchMovements stores the page under the productId key', async () => {
    const store = useInventoryStore();
    mockedList.mockResolvedValue({
      items: [{ id: 'm-1', productId: 'p-1', type: 'IN', quantity: 3 } as never],
      total: 1,
      page: 1,
      size: 50,
    });

    await store.fetchMovements('p-1');

    expect(store.getMovementsForProduct('p-1')).toHaveLength(1);
    expect(store.getMovementsForProduct('p-2')).toEqual([]);
    expect(store.currentTotal).toBe(1);
  });

  it('recordMovement prepends to the productId bucket and increments total', async () => {
    const store = useInventoryStore();
    mockedRecord.mockResolvedValue({
      id: 'm-2',
      productId: 'p-1',
      type: 'IN',
      quantity: 5,
    } as never);

    const movement = await store.recordMovement('p-1', {
      type: 'IN',
      quantity: 5,
    });

    expect(movement.id).toBe('m-2');
    expect(store.getMovementsForProduct('p-1')[0]!.id).toBe('m-2');
    expect(store.currentTotal).toBe(1);
  });
});

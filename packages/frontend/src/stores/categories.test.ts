/**
 * Unit tests for the categories Pinia store.
 *
 * Categories are read-only in the MVP (no create surface per
 * categories/spec.md). Test coverage focuses on:
 *  - initial empty state
 *  - fetchList — action that populates items
 *  - state mutation — error is captured on failure and cleared via clearError
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/services/categories', () => ({
  listCategories: vi.fn(),
}));

import { useCategoriesStore } from './categories';
import * as svc from '@/services/categories';

const mockedList = vi.mocked(svc.listCategories);

describe('useCategoriesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedList.mockReset();
  });

  it('starts with empty items, loading=false and error=null', () => {
    const store = useCategoriesStore();

    expect(store.items).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchList populates items from the service', async () => {
    const store = useCategoriesStore();
    mockedList.mockResolvedValue([
      { id: 'c-1', slug: 'beverages', name: 'Bebidas' },
      { id: 'c-2', slug: 'snacks', name: 'Snacks' },
    ]);

    await store.fetchList();

    expect(store.items).toHaveLength(2);
    expect(store.items[0]!.id).toBe('c-1');
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('captures an error message and supports clearError()', async () => {
    const store = useCategoriesStore();
    mockedList.mockRejectedValue({
      data: { code: 'INTERNAL_ERROR', message: 'Boom' },
    });

    await expect(store.fetchList()).rejects.toBeDefined();
    expect(store.error).toBe('Boom');
    expect(store.loading).toBe(false);

    store.clearError();
    expect(store.error).toBeNull();
  });
});

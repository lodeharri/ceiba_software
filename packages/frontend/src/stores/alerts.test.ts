/**
 * Unit tests for the alerts Pinia store.
 *
 * Covers:
 *  - initial empty state
 *  - fetchList — populates items/total/page and updates statusFilter
 *  - fetchOne — populates current
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/services/alerts', () => ({
  listAlerts: vi.fn(),
  getAlert: vi.fn(),
}));

import { useAlertsStore } from './alerts';
import * as svc from '@/services/alerts';

const mockedList = vi.mocked(svc.listAlerts);
const mockedGet = vi.mocked(svc.getAlert);

describe('useAlertsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedList.mockReset();
    mockedGet.mockReset();
  });

  it('starts with empty items, no current, no status filter and loading=false', () => {
    const store = useAlertsStore();

    expect(store.items).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.page).toBe(1);
    expect(store.current).toBeNull();
    expect(store.statusFilter).toBeUndefined();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchList populates items/total/page and tracks the status filter', async () => {
    const store = useAlertsStore();
    mockedList.mockResolvedValue({
      items: [{ id: 'a-1', productId: 'p-1', status: 'OPEN' } as never],
      total: 1,
      page: 1,
      size: 20,
    });

    await store.fetchList({ status: 'OPEN' });

    expect(store.items).toHaveLength(1);
    expect(store.total).toBe(1);
    expect(store.page).toBe(1);
    expect(store.statusFilter).toBe('OPEN');
  });

  it('fetchOne sets current to the returned alert', async () => {
    const store = useAlertsStore();
    mockedGet.mockResolvedValue({ id: 'a-2', productId: 'p-2', status: 'CLOSED' } as never);

    const result = await store.fetchOne('a-2');

    expect(result).toMatchObject({ id: 'a-2' });
    expect(store.current).toMatchObject({ id: 'a-2' });
  });
});

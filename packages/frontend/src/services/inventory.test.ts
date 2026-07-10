/**
 * Unit tests for the inventory service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test the wiring
 * (URL, query params, method, headers) of each service function.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listMovements, recordMovement } from './inventory';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

describe('inventory service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listMovements sends GET /products/:id/movements with default pagination', async () => {
    const page = { items: [], total: 0, page: 1, size: 50 };
    mockedHttp.mockResolvedValue(page);

    const result = await listMovements('p-1');

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/products/p-1/movements', {
      query: { page: 1, size: 50 },
    });
  });

  it('listMovements propagates a 5xx HTTP error', async () => {
    const apiError = Object.assign(new Error('Server error'), {
      statusCode: 500,
      data: { code: 'INTERNAL_ERROR', message: 'Boom' },
    });
    mockedHttp.mockRejectedValue(apiError);

    await expect(listMovements('p-1')).rejects.toMatchObject({ statusCode: 500 });
  });

  it('recordMovement POSTs the movement body under the product path with Idempotency-Key', async () => {
    const movement = {
      id: 'm-1',
      productId: 'p-1',
      type: 'IN',
      quantity: 5,
      createdAt: '2025-01-01T00:00:00.000Z',
    } as never;
    mockedHttp.mockResolvedValue(movement);
    useAuthStore();

    const input = { type: 'IN' as const, quantity: 5, reason: 'restock' };
    const result = await recordMovement('p-1', input);

    expect(result).toEqual(movement);
    expect(mockedHttp).toHaveBeenCalledTimes(1);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe('/products/p-1/movements');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual(input);
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

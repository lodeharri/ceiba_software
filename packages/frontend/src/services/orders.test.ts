/**
 * Unit tests for the orders service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listOrders, createOrder, approveOrder } from './orders';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

describe('orders service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listOrders sends GET /orders with default pagination', async () => {
    const page = { items: [], total: 0, page: 1, size: 20 };
    mockedHttp.mockResolvedValue(page);

    const result = await listOrders();

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/orders', {
      query: { page: 1, size: 20 },
    });
  });

  it('listOrders includes the status filter when provided', async () => {
    const page = { items: [], total: 0, page: 1, size: 20 };
    mockedHttp.mockResolvedValue(page);

    await listOrders({ status: 'PENDING' });

    expect(mockedHttp).toHaveBeenCalledWith('/orders', {
      query: { status: 'PENDING', page: 1, size: 20 },
    });
  });

  it('listOrders propagates a 4xx HTTP error', async () => {
    mockedHttp.mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        data: { code: 'FORBIDDEN', message: 'Not allowed' },
      }),
    );

    await expect(listOrders()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('createOrder POSTs the order body and sends an Idempotency-Key header', async () => {
    const order = {
      id: 'o-1',
      status: 'PENDING',
      lines: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    } as never;
    mockedHttp.mockResolvedValue(order);
    useAuthStore();

    const input = {
      supplierId: 's-1',
      lines: [{ productId: 'p-1', quantity: 5 }],
    };
    const result = await createOrder(input);

    expect(result).toEqual(order);
    expect(mockedHttp).toHaveBeenCalledTimes(1);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe('/orders');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual(input);
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('approveOrder POSTs to /orders/:id/approve with Idempotency-Key', async () => {
    const approved = { id: 'o-1', status: 'APPROVED' } as never;
    mockedHttp.mockResolvedValue(approved);
    useAuthStore();

    const result = await approveOrder('o-1', { note: 'ok' });

    expect(result).toEqual(approved);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe('/orders/o-1/approve');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ note: 'ok' });
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

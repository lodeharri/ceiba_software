/**
 * Unit tests for the orders service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test wiring.
 * Each happy-path test feeds a Zod-valid payload so the validation
 * layer in `services/orders.ts` accepts the response.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import {
  listOrders,
  getOrder,
  createOrder,
  approveOrder,
  rejectOrder,
  receiveOrder,
  InvalidOrdersResponseError,
} from './orders';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

const O = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const U = '33333333-3333-4333-8333-333333333333';

/** Build a Zod-valid Order matching the shared `orderSchema`. */
function makeOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: O,
    productId: P,
    productName: 'Coca',
    productSku: 'SKU-1',
    quantity: 5,
    supplierSnapshot: 'SnacksCorp',
    fromAlertId: null,
    status: 'PENDIENTE',
    rejectionReason: null,
    createdBy: U,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    receivedAt: null,
    ...overrides,
  };
}

/** Build a Zod-valid empty page envelope. */
function emptyEnvelope(): Record<string, unknown> {
  return { items: [], total: 0, page: 1, size: 20, hasMore: false };
}

describe('orders service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listOrders sends GET /orders with default pagination', async () => {
    const page = emptyEnvelope();
    mockedHttp.mockResolvedValue(page);

    const result = await listOrders();

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/orders', {
      query: { page: 1, size: 20 },
    });
  });

  it('listOrders includes the status filter when provided', async () => {
    const page = emptyEnvelope();
    mockedHttp.mockResolvedValue(page);

    await listOrders({ status: 'PENDIENTE' });

    expect(mockedHttp).toHaveBeenCalledWith('/orders', {
      query: { status: 'PENDIENTE', page: 1, size: 20 },
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

  it('listOrders throws InvalidOrdersResponseError when the envelope fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedHttp.mockResolvedValue({ items: [], page: 1, size: 20, total: 0 });

    await expect(listOrders()).rejects.toBeInstanceOf(InvalidOrdersResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('getOrder fetches a single order and returns the parsed body', async () => {
    const order = makeOrder();
    mockedHttp.mockResolvedValue(order);

    const result = await getOrder(O);

    expect(result).toEqual(order);
    expect(mockedHttp).toHaveBeenCalledWith(`/orders/${O}`);
  });

  it('getOrder throws InvalidOrdersResponseError when the body fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedHttp.mockResolvedValue({ id: O });

    await expect(getOrder(O)).rejects.toBeInstanceOf(InvalidOrdersResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('createOrder POSTs the order body and sends an Idempotency-Key header', async () => {
    const order = makeOrder();
    mockedHttp.mockResolvedValue(order);
    useAuthStore();

    const input = { productId: P, quantity: 5 };
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

  it('createOrder throws InvalidOrdersResponseError when the body fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedHttp.mockResolvedValue({ id: O });
    useAuthStore();

    await expect(createOrder({ productId: P, quantity: 5 })).rejects.toBeInstanceOf(
      InvalidOrdersResponseError,
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('approveOrder POSTs to /orders/:id/approve with Idempotency-Key', async () => {
    const approved = makeOrder({ status: 'APROBADA' });
    mockedHttp.mockResolvedValue(approved);
    useAuthStore();

    const result = await approveOrder(O, { note: 'ok' });

    expect(result).toEqual(approved);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe(`/orders/${O}/approve`);
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ note: 'ok' });
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('rejectOrder POSTs to /orders/:id/reject with Idempotency-Key', async () => {
    const rejected = makeOrder({ status: 'RECHAZADA', rejectionReason: 'Proveedor sin stock.' });
    mockedHttp.mockResolvedValue(rejected);
    useAuthStore();

    const result = await rejectOrder(O, { reason: 'Proveedor sin stock.' });

    expect(result).toEqual(rejected);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe(`/orders/${O}/reject`);
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('receiveOrder POSTs to /orders/:id/receive with Idempotency-Key', async () => {
    const received = makeOrder({ status: 'RECIBIDA', receivedAt: '2025-01-05T00:00:00.000Z' });
    mockedHttp.mockResolvedValue(received);
    useAuthStore();

    const result = await receiveOrder(O, { receivedQuantity: 5 });

    expect(result).toEqual(received);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe(`/orders/${O}/receive`);
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ receivedQuantity: 5 });
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

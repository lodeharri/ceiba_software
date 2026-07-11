/**
 * Unit tests for the inventory service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test the wiring
 * (URL, query params, method, headers) of each service function and
 * the Zod validation boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listMovements, recordMovement, InvalidInventoryResponseError } from './inventory';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

const P = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';

/** Build a Zod-valid Movement matching the shared `movementSchema`. */
function makeMovement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    productId: P,
    type: 'ENTRADA',
    quantity: 5,
    reason: 'restock',
    userId: U,
    stockAfter: 15,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a Zod-valid empty page envelope. */
function emptyEnvelope(): Record<string, unknown> {
  return { items: [], total: 0, page: 1, size: 50, hasMore: false };
}

describe('inventory service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listMovements sends GET /products/:id/movements with default pagination', async () => {
    const page = emptyEnvelope();
    mockedHttp.mockResolvedValue(page);

    const result = await listMovements(P);

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith(`/products/${P}/movements`, {
      query: { page: 1, size: 50 },
    });
  });

  it('listMovements propagates a 5xx HTTP error', async () => {
    const apiError = Object.assign(new Error('Server error'), {
      statusCode: 500,
      data: { code: 'INTERNAL_ERROR', message: 'Boom' },
    });
    mockedHttp.mockRejectedValue(apiError);

    await expect(listMovements(P)).rejects.toMatchObject({ statusCode: 500 });
  });

  it('listMovements throws InvalidInventoryResponseError when the envelope fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedHttp.mockResolvedValue({ items: [], page: 1, size: 50, total: 0 });

    await expect(listMovements(P)).rejects.toBeInstanceOf(InvalidInventoryResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('recordMovement POSTs the movement body under the product path with Idempotency-Key', async () => {
    const movement = makeMovement();
    mockedHttp.mockResolvedValue(movement);
    useAuthStore();

    const input = { type: 'ENTRADA' as const, quantity: 5, reason: 'restock' };
    const result = await recordMovement(P, input);

    expect(result).toEqual(movement);
    expect(mockedHttp).toHaveBeenCalledTimes(1);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe(`/products/${P}/movements`);
    expect(options.method).toBe('POST');
    expect(options.body).toEqual(input);
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('recordMovement throws InvalidInventoryResponseError when the body fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Missing stockAfter / userId.
    mockedHttp.mockResolvedValue({
      id: '99999999-9999-4999-8999-999999999999',
      productId: P,
      type: 'ENTRADA',
      quantity: 5,
      reason: 'restock',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    useAuthStore();

    await expect(
      recordMovement(P, { type: 'ENTRADA' as const, quantity: 5, reason: 'restock' }),
    ).rejects.toBeInstanceOf(InvalidInventoryResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

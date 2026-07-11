/**
 * Unit tests for the products service.
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

import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  InvalidProductsResponseError,
} from './products';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

const P = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';

/** Build a Zod-valid Product matching the shared `productSchema`. */
function makeProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: P,
    sku: 'SKU-001',
    name: 'Coca',
    price: '5000',
    stock: 5,
    stockMin: 10,
    supplier: 'SnacksCorp',
    categoryId: C,
    hasActiveAlert: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a Zod-valid empty page envelope. */
function emptyEnvelope(): Record<string, unknown> {
  return { items: [], total: 0, page: 1, size: 20, hasMore: false };
}

describe('products service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listProducts sends GET /products with default pagination', async () => {
    const page = { ...emptyEnvelope(), items: [makeProduct()], total: 1 };
    mockedHttp.mockResolvedValue(page);

    const result = await listProducts({ categoryId: C });

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/products', {
      query: { categoryId: C, page: 1, size: 20 },
    });
  });

  it('listProducts propagates a 4xx HTTP error to the caller', async () => {
    const apiError = Object.assign(new Error('Forbidden'), {
      statusCode: 403,
      data: { code: 'FORBIDDEN', message: 'Not allowed' },
    });
    mockedHttp.mockRejectedValue(apiError);

    await expect(listProducts()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockedHttp).toHaveBeenCalledTimes(1);
  });

  it('listProducts throws InvalidProductsResponseError when the envelope fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Missing `hasMore` and `items` is the wrong type.
    mockedHttp.mockResolvedValue({ items: 'not-an-array', page: 1, size: 20, total: 0 });

    await expect(listProducts()).rejects.toBeInstanceOf(InvalidProductsResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('getProduct builds the resource path with the id', async () => {
    const product = makeProduct();
    mockedHttp.mockResolvedValue(product);

    const result = await getProduct(P);

    expect(result).toEqual(product);
    expect(mockedHttp).toHaveBeenCalledWith(`/products/${P}`);
  });

  it('getProduct throws InvalidProductsResponseError when the body fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Missing required fields: price / stock / stockMin / supplier / categoryId.
    mockedHttp.mockResolvedValue({ id: P, sku: 'SKU-1', name: 'Coca' });

    await expect(getProduct(P)).rejects.toBeInstanceOf(InvalidProductsResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('createProduct POSTs the body and sends an Idempotency-Key header', async () => {
    const created = makeProduct({ id: '99999999-9999-4999-8999-999999999999' });
    mockedHttp.mockResolvedValue(created);
    // The auth store is required for the onRequest hook in real http;
    // we mocked the http module, but loading it keeps the code path stable.
    useAuthStore();

    const input = {
      sku: 'SKU-2',
      name: 'New Product',
      categoryId: C,
      unitPrice: 1500,
      minStock: 0,
      initialStock: 0,
    };
    const result = await createProduct(input);

    expect(result).toEqual(created);
    expect(mockedHttp).toHaveBeenCalledTimes(1);
    const [, options] = mockedHttp.mock.calls[0]!;
    expect(options.method).toBe('POST');
    expect(options.body).toEqual(input);
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('createProduct throws InvalidProductsResponseError when the body fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedHttp.mockResolvedValue({ id: P });
    useAuthStore();

    await expect(
      createProduct({
        sku: 'SKU-2',
        name: 'New Product',
        categoryId: C,
        unitPrice: 1500,
        minStock: 0,
        initialStock: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidProductsResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('updateProduct PATCHes the body and sends an Idempotency-Key header', async () => {
    const updated = makeProduct({ name: 'Updated Name' });
    mockedHttp.mockResolvedValue(updated);
    useAuthStore();

    const input = { name: 'Updated Name' };
    const result = await updateProduct(P, input);

    expect(result).toEqual(updated);
    expect(mockedHttp).toHaveBeenCalledTimes(1);
    const [url, options] = mockedHttp.mock.calls[0]!;
    expect(url).toBe(`/products/${P}`);
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual(input);
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

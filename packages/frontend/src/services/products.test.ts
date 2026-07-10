/**
 * Unit tests for the products service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test the wiring
 * (URL, query params, method, headers) of each service function.
 *
 * Coverage:
 *  - listProducts — happy path
 *  - listProducts — propagates HTTP errors
 *  - getProduct — builds the path with the resource id
 *  - createProduct — POST with body + Idempotency-Key header
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listProducts, getProduct, createProduct } from './products';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

describe('products service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listProducts sends GET /products with default pagination', async () => {
    const page = {
      items: [
        { id: 'p-1', sku: 'SKU-1', name: 'Coca', categoryId: 'c-1', currentStock: 5 },
      ] as never,
      total: 1,
      page: 1,
      size: 20,
    };
    mockedHttp.mockResolvedValue(page);

    const result = await listProducts({ categoryId: 'c-1' });

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/products', {
      query: { categoryId: 'c-1', page: 1, size: 20 },
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

  it('getProduct builds the resource path with the id', async () => {
    const product = { id: 'p-1', sku: 'SKU-1', name: 'Coca' } as never;
    mockedHttp.mockResolvedValue(product);

    const result = await getProduct('p-1');

    expect(result).toEqual(product);
    expect(mockedHttp).toHaveBeenCalledWith('/products/p-1');
  });

  it('createProduct POSTs the body and sends an Idempotency-Key header', async () => {
    const created = { id: 'p-2', sku: 'SKU-2', name: 'New' } as never;
    mockedHttp.mockResolvedValue(created);
    // The auth store is required for the onRequest hook in real http;
    // we mocked the http module, but loading it keeps the code path stable.
    useAuthStore();

    const input = {
      sku: 'SKU-2',
      name: 'New',
      categoryId: 'c-1',
      unitPrice: 1.5,
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
});

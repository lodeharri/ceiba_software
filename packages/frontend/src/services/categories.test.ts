/**
 * Unit tests for the categories service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test wiring.
 * The backend returns a page envelope; the service validates it with
 * `pageEnvelopeSchema(categorySchema)` and surfaces `items` to callers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listCategories, createCategory, InvalidCategoriesResponseError } from './categories';
import { useAuthStore } from '@/stores/auth';
import { http } from './http';

const mockedHttp = vi.mocked(http);

describe('categories service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listCategories sends GET /categories and returns the items array from the envelope', async () => {
    const envelope = {
      items: [
        {
          id: 'c1d2e3f4-1111-4111-8111-111111111111',
          name: 'Bebidas',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'c1d2e3f4-2222-4222-8222-222222222222',
          name: 'Snacks',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      size: 2,
      total: 2,
      hasMore: false,
    };
    mockedHttp.mockResolvedValue(envelope);

    const result = await listCategories();

    expect(result).toEqual(envelope.items);
    expect(mockedHttp).toHaveBeenCalledWith('/categories');
  });

  it('listCategories propagates a 5xx HTTP error', async () => {
    mockedHttp.mockRejectedValue(
      Object.assign(new Error('Server error'), {
        statusCode: 500,
        data: { code: 'INTERNAL_ERROR', message: 'Boom' },
      }),
    );

    await expect(listCategories()).rejects.toMatchObject({ statusCode: 500 });
  });

  it('listCategories throws InvalidCategoriesResponseError when the envelope fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Missing `hasMore` and `items` is wrong shape.
    mockedHttp.mockResolvedValue({
      items: 'not-an-array',
      page: 1,
      size: 0,
      total: 0,
    });

    await expect(listCategories()).rejects.toBeInstanceOf(InvalidCategoriesResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('createCategory POSTs { name } and returns a validated Category', async () => {
    const created = {
      id: 'c0000000-0000-4000-8000-000000000001',
      name: 'Lácteos',
      createdAt: '2025-06-01T00:00:00.000Z',
    };
    mockedHttp.mockResolvedValue(created);
    useAuthStore(); // required by http onRequest hook

    const result = await createCategory('Lácteos');

    expect(result).toEqual(created);
    expect(mockedHttp).toHaveBeenCalledWith('/categories', {
      method: 'POST',
      body: { name: 'Lácteos' },
    });
  });

  it('createCategory throws InvalidCategoriesResponseError when response fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedHttp.mockResolvedValue({ id: 'c-uuid' }); // missing name / createdAt
    useAuthStore();

    await expect(createCategory('New')).rejects.toBeInstanceOf(InvalidCategoriesResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('createCategory propagates a 4xx HTTP error to the caller', async () => {
    mockedHttp.mockRejectedValue(
      Object.assign(new Error('Conflict'), {
        statusCode: 409,
        data: { code: 'CONFLICT', message: 'Categoría duplicada' },
      }),
    );

    await expect(createCategory('Bebidas')).rejects.toMatchObject({ statusCode: 409 });
  });
});

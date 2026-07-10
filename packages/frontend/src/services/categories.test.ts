/**
 * Unit tests for the categories service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listCategories } from './categories';
import { http } from './http';

const mockedHttp = vi.mocked(http);

describe('categories service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listCategories sends GET /categories and returns the array', async () => {
    const categories = [
      { id: 'c-1', slug: 'beverages', name: 'Bebidas' },
      { id: 'c-2', slug: 'snacks', name: 'Snacks' },
    ];
    mockedHttp.mockResolvedValue(categories);

    const result = await listCategories();

    expect(result).toEqual(categories);
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
});

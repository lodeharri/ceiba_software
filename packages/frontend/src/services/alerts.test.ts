/**
 * Unit tests for the alerts service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listAlerts, getAlert } from './alerts';
import { http } from './http';

const mockedHttp = vi.mocked(http);

describe('alerts service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listAlerts sends GET /alerts with default pagination and no status', async () => {
    const page = { items: [], total: 0, page: 1, size: 20 };
    mockedHttp.mockResolvedValue(page);

    const result = await listAlerts();

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/alerts', {
      query: { page: 1, size: 20 },
    });
  });

  it('listAlerts includes the status filter when provided', async () => {
    const page = { items: [], total: 0, page: 1, size: 20 };
    mockedHttp.mockResolvedValue(page);

    await listAlerts({ status: 'OPEN' });

    expect(mockedHttp).toHaveBeenCalledWith('/alerts', {
      query: { status: 'OPEN', page: 1, size: 20 },
    });
  });

  it('listAlerts propagates a 4xx HTTP error', async () => {
    mockedHttp.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), {
        statusCode: 401,
        data: { code: 'UNAUTHORIZED', message: 'No token' },
      }),
    );

    await expect(listAlerts()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('getAlert builds the resource path with the id', async () => {
    const alert = { id: 'a-1', productId: 'p-1', status: 'OPEN' } as never;
    mockedHttp.mockResolvedValue(alert);

    const result = await getAlert('a-1');

    expect(result).toEqual(alert);
    expect(mockedHttp).toHaveBeenCalledWith('/alerts/a-1');
  });
});

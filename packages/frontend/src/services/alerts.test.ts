/**
 * Unit tests for the alerts service.
 *
 * Mocked at the HTTP layer (`./http`) so we only test wiring.
 * Each happy-path test feeds a Zod-valid envelope so the validation
 * layer in `services/alerts.ts` accepts the payload.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { listAlerts, getAlert, InvalidAlertsResponseError } from './alerts';
import { http } from './http';

const mockedHttp = vi.mocked(http);

/** Build a Zod-valid empty page envelope. */
function emptyEnvelope(): Record<string, unknown> {
  return { items: [], total: 0, page: 1, size: 20, hasMore: false };
}

describe('alerts service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('listAlerts sends GET /alerts with default pagination and no status', async () => {
    const page = emptyEnvelope();
    mockedHttp.mockResolvedValue(page);

    const result = await listAlerts();

    expect(result).toEqual(page);
    expect(mockedHttp).toHaveBeenCalledWith('/alerts', {
      query: { page: 1, size: 20 },
    });
  });

  it('listAlerts includes the status filter when provided', async () => {
    const page = emptyEnvelope();
    mockedHttp.mockResolvedValue(page);

    await listAlerts({ status: 'ACTIVA' });

    expect(mockedHttp).toHaveBeenCalledWith('/alerts', {
      query: { status: 'ACTIVA', page: 1, size: 20 },
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

  it('listAlerts throws InvalidAlertsResponseError when the envelope fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Missing hasMore, items is a string instead of an array.
    mockedHttp.mockResolvedValue({ items: 'not-an-array', total: 0, page: 1, size: 20 });

    await expect(listAlerts()).rejects.toBeInstanceOf(InvalidAlertsResponseError);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('getAlert builds the resource path with the id', async () => {
    const alert = {
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      productId: '11111111-1111-4111-8111-111111111111',
      productName: 'Coca',
      productSku: 'SKU-1',
      stockAtOpen: 5,
      stockMin: 10,
      status: 'ACTIVA',
      resolvedAt: null,
      createdAt: '2025-01-15T10:00:00.000Z',
    };
    mockedHttp.mockResolvedValue(alert);

    const result = await getAlert('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    expect(result).toEqual(alert);
    expect(mockedHttp).toHaveBeenCalledWith('/alerts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('getAlert throws InvalidAlertsResponseError when the payload fails Zod validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Missing required fields: productName / stockAtOpen / stockMin.
    mockedHttp.mockResolvedValue({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      productId: '11111111-1111-4111-8111-111111111111',
      productSku: 'SKU-1',
      status: 'ACTIVA',
      resolvedAt: null,
      createdAt: '2025-01-15T10:00:00.000Z',
    });

    await expect(getAlert('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).rejects.toBeInstanceOf(
      InvalidAlertsResponseError,
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { AlertNotFoundError } from '../../domain/errors/alert-not-found.js';

// Module-level mocks must be defined before importing the handler
vi.mock('../../bootstrap.js', () => {
  const mockGetAlert = vi.fn();
  const mockListAlerts = vi.fn();
  return {
    getAlertsBootstrap: vi.fn(() => ({
      getAlert: { execute: mockGetAlert },
      listAlerts: { execute: mockListAlerts },
    })),
    _resetMock: () => {
      mockGetAlert.mockReset();
      mockListAlerts.mockReset();
    },
    _getMockGetAlert: () => mockGetAlert,
    _getMockListAlerts: () => mockListAlerts,
  };
});

// Dynamic import so mocks apply
const { handler } = await import('./get-alert.js');
const { _getMockGetAlert, _resetMock } = await import('../../bootstrap.js');

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: {
        method: 'GET',
        path: '/api/v1/alerts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
    },
    headers: {},
    rawPath: '/api/v1/alerts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    rawQueryString: '',
    routeKey: 'GET /api/v1/alerts/{id}',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

describe('GET /alerts/{id} handler', () => {
  beforeEach(() => {
    _resetMock();
  });

  it('returns 200 with alert and product snapshot on success', async () => {
    _getMockGetAlert().mockResolvedValue({
      alert: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        productId: '11111111-1111-4111-8111-111111111111',
        status: 'ACTIVA',
        type: 'STOCK_BAJO',
        resolvedAt: undefined,
        createdAt: new Date('2025-01-15T10:00:00Z'),
      },
      product: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Test Product',
        sku: 'SKU123',
        stock: 5,
        stockMin: 10,
      },
    });

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.alert.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(body.alert.status).toBe('ACTIVA');
    expect(body.product.name).toBe('Test Product');
  });

  it('returns 404 for unknown alert id', async () => {
    _getMockGetAlert().mockRejectedValue(
      new AlertNotFoundError('00000000-0000-4000-8000-000000000000'),
    );

    const event = makeEvent({
      rawPath: '/api/v1/alerts/00000000-0000-4000-8000-000000000000',
    });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('returns 400 for malformed id', async () => {
    const event = makeEvent({ rawPath: '/api/v1/alerts/bad-id' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });
});

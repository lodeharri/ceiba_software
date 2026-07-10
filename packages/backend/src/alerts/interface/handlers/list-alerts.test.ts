import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

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
const { handler } = await import('./list-alerts.js');
const { _getMockListAlerts, _resetMock } = await import('../../bootstrap.js');

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: {
        method: 'GET',
        path: '/api/v1/alerts',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
    },
    headers: {},
    rawPath: '/api/v1/alerts',
    rawQueryString: '',
    routeKey: 'GET /api/v1/alerts',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

describe('GET /alerts handler', () => {
  beforeEach(() => {
    _resetMock();
  });

  it('returns 200 with paginated alerts on success', async () => {
    _getMockListAlerts().mockResolvedValue({
      items: [
        {
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
        },
      ],
      page: 0,
      size: 20,
      total: 1,
      hasMore: false,
    });

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].alert.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(body.items[0].product.name).toBe('Test Product');
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('returns 400 for invalid status query param', async () => {
    const error = new Error("Invalid status: 'INVALID'");
    (error as any).httpStatus = 400; // eslint-disable-line @typescript-eslint/no-explicit-any
    (error as any).code = ErrorCode.VALIDATION_ERROR; // eslint-disable-line @typescript-eslint/no-explicit-any
    _getMockListAlerts().mockRejectedValue(error);

    const event = makeEvent({ rawQueryString: 'status=INVALID' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('passes query params to use case', async () => {
    _getMockListAlerts().mockResolvedValue({
      items: [],
      page: 0,
      size: 10,
      total: 0,
      hasMore: false,
    });

    const event = makeEvent({ rawQueryString: 'status=ACTIVA&page=0&size=10' });
    await handler(event, {} as never, () => {});

    expect(_getMockListAlerts()).toHaveBeenCalledWith({
      status: 'ACTIVA',
      page: 0,
      size: 10,
    });
  });
});

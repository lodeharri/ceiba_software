import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

// Module-level mocks must be defined before importing the handler
// Mock JWT verification for handler tests
vi.mock('../../../shared/jwt-middleware.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ sub: '33333333-3333-3333-3333-333333333333' }),
}));

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
    headers: {
      authorization:
        'Bearer header.eyJzdWIiOiAiMzMzMzMzMzMtMzMzMy0zMzMzLTMzMzMtMzMzMzMzMzMzMzMzIiwgImV4cCI6IDk5OTk5OTk5OTl9.signature',
    },
    rawPath: '/api/v1/alerts',
    rawQueryString: '',
    routeKey: 'GET /api/v1/alerts',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

/**
 * Build the flat `AlertReadModel` shape returned by the use case after
 * `composeAlert(alert, product)` (see `application/compose-alert.ts`).
 * The handler must serialize this directly — no `{ alert, product }`
 * wrapper.
 */
function makeFlatAlert(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    productId: '11111111-1111-4111-8111-111111111111',
    productName: 'Test Product',
    productSku: 'SKU123',
    stockAtOpen: 5,
    stockMin: 10,
    status: 'ACTIVA',
    resolvedAt: null,
    createdAt: '2025-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('GET /alerts handler', () => {
  beforeEach(() => {
    _resetMock();
  });

  it('returns 200 with flat paginated alerts on success', async () => {
    _getMockListAlerts().mockResolvedValue({
      items: [makeFlatAlert()],
      page: 1,
      size: 20,
      total: 1,
      hasMore: false,
    });

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.items).toHaveLength(1);
    // Flat shape: id / productName / productSku live on the item itself,
    // NOT under `item.alert` / `item.product`.
    expect(body.items[0].id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(body.items[0].productName).toBe('Test Product');
    expect(body.items[0].productSku).toBe('SKU123');
    expect(body.items[0].stockAtOpen).toBe(5);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('regression guard: does not wrap items under { alert, product }', async () => {
    _getMockListAlerts().mockResolvedValue({
      items: [makeFlatAlert()],
      page: 1,
      size: 20,
      total: 1,
      hasMore: false,
    });

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    const body = JSON.parse(result.body as string);
    // The previous (wrong) shape nested every row under `{ alert, product }`.
    // If a future refactor reintroduces that wrapper, this guard fires.
    expect(body.items[0].alert).toBeUndefined();
    expect(body.items[0].product).toBeUndefined();
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

  it('returns 400 for page=0', async () => {
    const event = makeEvent({ rawQueryString: 'page=0' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(_getMockListAlerts()).not.toHaveBeenCalled();
  });

  it('passes one-indexed query params to use case', async () => {
    _getMockListAlerts().mockResolvedValue({
      items: [],
      page: 1,
      size: 10,
      total: 0,
      hasMore: false,
    });

    const event = makeEvent({ rawQueryString: 'status=ACTIVA&page=1&size=10' });
    await handler(event, {} as never, () => {});

    expect(_getMockListAlerts()).toHaveBeenCalledWith({
      status: 'ACTIVA',
      page: 1,
      size: 10,
    });
  });
});

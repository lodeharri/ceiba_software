import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { AlertNotFoundError } from '../../domain/errors/alert-not-found.js';

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
    headers: {
      authorization:
        'Bearer header.eyJzdWIiOiAiMzMzMzMzMzMtMzMzMy0zMzMzLTMzMzMtMzMzMzMzMzMzMzMzIiwgImV4cCI6IDk5OTk5OTk5OTl9.signature',
    },
    rawPath: '/api/v1/alerts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    rawQueryString: '',
    routeKey: 'GET /api/v1/alerts/{id}',
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

describe('GET /alerts/{id} handler', () => {
  beforeEach(() => {
    _resetMock();
  });

  it('returns 200 with flat alert on success', async () => {
    _getMockGetAlert().mockResolvedValue(makeFlatAlert());

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    // Flat shape: id / productName / productSku / stockAtOpen / stockMin
    // live directly on body (not under nested `alert`/`product` keys).
    expect(body.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(body.status).toBe('ACTIVA');
    expect(body.productName).toBe('Test Product');
    expect(body.productSku).toBe('SKU123');
    expect(body.stockAtOpen).toBe(5);
    expect(body.stockMin).toBe(10);
  });

  it('regression guard: body does not contain a top-level `product` field', async () => {
    _getMockGetAlert().mockResolvedValue(makeFlatAlert());

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    const body = JSON.parse(result.body as string);
    // The previous (wrong) shape returned `{ alert: {...}, product: {...} }`.
    // If a future refactor reintroduces that wrapper, this guard fires.
    expect(body.product).toBeUndefined();
    // Regression guard: no envelope { alert }
    expect(body.alert).toBeUndefined();
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

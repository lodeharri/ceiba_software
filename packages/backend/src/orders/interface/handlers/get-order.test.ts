/**
 * RED test: get-order handler (PR 2c).
 */

import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const O = '11111111-1111-1111-1111-111111111111';

function makeEvent(orderId: string = O): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: 'GET', path: `/api/v1/orders/${orderId}`, sourceIp: '127.0.0.1' },
    },
    headers: {
      authorization:
        'Bearer header.eyJzdWIiOiAiMzMzMzMzMzMtMzMzMy0zMzMzLTMzMzMtMzMzMzMzMzMzMzMzIiwgImV4cCI6IDk5OTk5OTk5OTl9.signature',
    },
    rawPath: `/api/v1/orders/${orderId}`,
    rawQueryString: '',
    routeKey: 'GET /api/v1/orders/{id}',
  } as unknown as APIGatewayProxyEventV2;
}

// Mock JWT verification for handler tests
vi.mock('../../../shared/jwt-middleware.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ sub: '33333333-3333-3333-3333-333333333333' }),
}));

vi.mock('./bootstrap.js', () => ({
  getOrdersBootstrap: vi.fn(() => ({
    getOrderUseCase: {
      execute: vi.fn().mockResolvedValue({
        id: O,
        productId: 'p1',
        productName: 'Cerveza',
        productSku: 'SKU-001',
        quantity: 60,
        supplierSnapshot: 'SnacksCorp',
        fromAlertId: null,
        status: 'PENDIENTE',
        rejectionReason: null,
        createdBy: 'u1',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        receivedAt: null,
      }),
    },
  })),
}));

const { handler } = await import('./get-order.js');

const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('GET /api/v1/orders/{id} handler', () => {
  it('regression: response body does not contain envelope { order }', async () => {
    const result = await (
      handler as (
        e: APIGatewayProxyEventV2,
        c: unknown,
      ) => Promise<{ statusCode: number; body?: string }>
    )(makeEvent(O), CTX);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.order).toBeUndefined();
  });

  it('returns 200 with composed order', async () => {
    const result = await (
      handler as (
        e: APIGatewayProxyEventV2,
        c: unknown,
      ) => Promise<{ statusCode: number; body?: string }>
    )(makeEvent(O), CTX);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.productName).toBe('Cerveza');
    expect(body.productSku).toBe('SKU-001');
    // Regression guard: no envelope, no requestId in body
    expect(body.order).toBeUndefined();
    expect(body.requestId).toBeUndefined();
  });
});

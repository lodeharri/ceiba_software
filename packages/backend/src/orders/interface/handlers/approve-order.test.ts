/**
 * RED test: approve-order handler (PR 2c).
 */

import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const O = '11111111-1111-1111-1111-111111111111';
const U = '33333333-3333-3333-3333-333333333333';

// Mock JWT with valid structure (base64url-encoded payload with sub claim)
const mockJwtPayload = { sub: U, exp: Math.floor(Date.now() / 1000) + 3600 };
const mockJwt = `header.${Buffer.from(JSON.stringify(mockJwtPayload)).toString('base64url').replace(/=+$/, '')}.signature`;

function makeEvent(orderId: string = O): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: 'POST', path: `/api/v1/orders/${orderId}/approve`, sourceIp: '127.0.0.1' },
    },
    headers: { authorization: `Bearer ${mockJwt}` },
    rawPath: `/api/v1/orders/${orderId}/approve`,
    rawQueryString: '',
    routeKey: 'POST /api/v1/orders/{id}/approve',
  } as unknown as APIGatewayProxyEventV2;
}

// Mock JWT verification for handler tests
vi.mock('../../../shared/jwt-middleware.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ sub: '33333333-3333-3333-3333-333333333333' }),
}));

vi.mock('./bootstrap.js', () => ({
  getOrdersBootstrap: vi.fn(() => ({
    approveOrderUseCase: {
      execute: vi.fn().mockResolvedValue({
        id: O,
        productId: 'product-1',
        productName: 'Cerveza',
        productSku: 'SKU-001',
        quantity: 60,
        supplierSnapshot: 'SnacksCorp',
        fromAlertId: null,
        status: 'APROBADA',
        rejectionReason: null,
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        receivedAt: null,
      }),
    },
  })),
}));

const { handler } = await import('./approve-order.js');
const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('POST /api/v1/orders/{id}/approve handler', () => {
  it('returns 200 on happy approve with composed productName/productSku', async () => {
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
    expect(body.status).toBe('APROBADA');
  });
});

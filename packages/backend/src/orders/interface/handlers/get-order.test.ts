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
    headers: {},
    rawPath: `/api/v1/orders/${orderId}`,
    rawQueryString: '',
    routeKey: 'GET /api/v1/orders/{id}',
  } as unknown as APIGatewayProxyEventV2;
}

vi.mock('./bootstrap.js', () => ({
  getOrdersBootstrap: vi.fn(() => ({
    getOrderUseCase: {
      execute: vi.fn().mockResolvedValue({ order: { id: O, status: 'PENDIENTE' } }),
    },
  })),
}));

const { handler } = await import('./get-order.js');

const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('GET /api/v1/orders/{id} handler', () => {
  it('returns 200 with order', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent(O), CTX);
    expect(result.statusCode).toBe(200);
  });
});

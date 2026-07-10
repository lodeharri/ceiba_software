/**
 * RED test: approve-order handler (PR 2c).
 */

import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const O = '11111111-1111-1111-1111-111111111111';

function makeEvent(orderId: string = O): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: 'POST', path: `/api/v1/orders/${orderId}/approve`, sourceIp: '127.0.0.1' },
    },
    headers: {},
    rawPath: `/api/v1/orders/${orderId}/approve`,
    rawQueryString: '',
    routeKey: 'POST /api/v1/orders/{id}/approve',
  } as unknown as APIGatewayProxyEventV2;
}

vi.mock('./bootstrap.js', () => ({
  getOrdersBootstrap: vi.fn(() => ({
    approveOrderUseCase: { execute: vi.fn().mockResolvedValue({ id: O, status: 'APROBADA' }) },
  })),
}));

const { handler } = await import('./approve-order.js');
const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('POST /api/v1/orders/{id}/approve handler', () => {
  it('returns 200 on happy approve', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent(O), CTX);
    expect(result.statusCode).toBe(200);
  });
});

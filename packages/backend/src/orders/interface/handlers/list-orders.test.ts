/**
 * RED test: list-orders handler (PR 2c).
 */

import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: 'GET', path: '/api/v1/orders', sourceIp: '127.0.0.1' } },
    headers: {},
    rawPath: '/api/v1/orders',
    rawQueryString: '',
    routeKey: 'GET /api/v1/orders',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

vi.mock('./bootstrap.js', () => ({
  getOrdersBootstrap: vi.fn(() => ({
    listOrdersUseCase: {
      execute: vi.fn().mockResolvedValue({
        items: [{ id: '1', status: 'PENDIENTE' }],
        page: 1,
        size: 20,
        total: 1,
        hasMore: false,
      }),
    },
  })),
}));

const { handler } = await import('./list-orders.js');

const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('GET /api/v1/orders handler', () => {
  it('returns 200 with order list', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent(), CTX);
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 for invalid status filter', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent({ queryStringParameters: { status: 'INVALID' } }), CTX);
    expect(result.statusCode).toBe(400);
  });
});

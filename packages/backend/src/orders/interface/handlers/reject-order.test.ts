/**
 * RED test: reject-order handler (PR 2c).
 */

import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const O = '11111111-1111-1111-1111-111111111111';
const U = '33333333-3333-3333-3333-333333333333';

// Mock JWT with valid structure (base64url-encoded payload with sub claim)
const mockJwtPayload = { sub: U, exp: Math.floor(Date.now() / 1000) + 3600 };
const mockJwt = `header.${Buffer.from(JSON.stringify(mockJwtPayload)).toString('base64url').replace(/=+$/, '')}.signature`;

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: 'POST', path: `/api/v1/orders/${O}/reject`, sourceIp: '127.0.0.1' },
    },
    headers: { authorization: `Bearer ${mockJwt}` },
    rawPath: `/api/v1/orders/${O}/reject`,
    rawQueryString: '',
    routeKey: 'POST /api/v1/orders/{id}/reject',
    body: JSON.stringify({ reason: 'Proveedor sin stock hasta el lunes.' }),
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

vi.mock('./bootstrap.js', () => ({
  getOrdersBootstrap: vi.fn(() => ({
    rejectOrderUseCase: {
      execute: vi
        .fn()
        .mockResolvedValue({ id: O, status: 'RECHAZADA', reason: 'Proveedor sin stock.' }),
    },
  })),
}));

const { handler } = await import('./reject-order.js');
const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('POST /api/v1/orders/{id}/reject handler', () => {
  it('returns 200 on happy reject', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent(), CTX);
    expect(result.statusCode).toBe(200);
  });

  it('returns 422 when reason < 10 chars', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent({ body: JSON.stringify({ reason: 'no' }) }), CTX);
    expect(result.statusCode).toBe(422);
  });
});

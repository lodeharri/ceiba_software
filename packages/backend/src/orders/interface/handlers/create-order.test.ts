/**
 * RED test: create-order handler (PR 2c).
 *
 * Pattern matches inventory/record-movement.test.ts (PR 2b).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const VALID_SUB = '33333333-3333-3333-3333-333333333333';
const VALID_PRODUCT = '22222222-2222-2222-2222-222222222222';

function fakeJwt(sub: string = VALID_SUB): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, iat: Date.now() })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: 'POST', path: '/api/v1/orders', sourceIp: '127.0.0.1' } },
    headers: { 'content-type': 'application/json', authorization: `Bearer ${fakeJwt()}` },
    body: JSON.stringify({ productId: VALID_PRODUCT, quantity: 60 }),
    rawPath: '/api/v1/orders',
    rawQueryString: '',
    routeKey: 'POST /api/v1/orders',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

// Module-level mock must be before the dynamic import
vi.mock('./bootstrap.js', () => {
  const mockExecute = vi.fn();
  return {
    getOrdersBootstrap: vi.fn(() => ({
      createOrderUseCase: { execute: mockExecute },
    })),
    _resetMockCreateOrder: () => mockExecute.mockReset(),
    _getMockCreateOrder: () => mockExecute,
  };
});

const { handler } = await import('./create-order.js');
const { _getMockCreateOrder, _resetMockCreateOrder } = await import('./bootstrap.js');

const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

beforeEach(() => {
  _resetMockCreateOrder();
});

describe('POST /api/v1/orders handler', () => {
  it('returns 201 with composed order on happy path', async () => {
    _getMockCreateOrder().mockResolvedValue({
      id: '1',
      productId: VALID_PRODUCT,
      productName: 'Cerveza',
      productSku: 'SKU-001',
      quantity: 60,
      supplierSnapshot: 'SnacksCorp',
      fromAlertId: null,
      status: 'PENDIENTE',
      rejectionReason: null,
      createdBy: VALID_SUB,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      receivedAt: null,
    });
    const result = await (
      handler as (
        e: APIGatewayProxyEventV2,
        c: unknown,
      ) => Promise<{ statusCode: number; body: string }>
    )(makeEvent(), CTX);
    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body!);
    expect(body.id).toBe('1');
    expect(body.status).toBe('PENDIENTE');
    expect(body.productName).toBe('Cerveza');
    expect(body.productSku).toBe('SKU-001');
  });

  it('returns 400 for invalid JSON body', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent({ body: 'not-json' }), CTX);
    expect(result.statusCode).toBe(400);
  });

  it('returns 401 for missing auth header', async () => {
    const result = await (
      handler as (e: APIGatewayProxyEventV2, c: unknown) => Promise<{ statusCode: number }>
    )(makeEvent({ headers: {} }), CTX);
    expect(result.statusCode).toBe(401);
  });
});

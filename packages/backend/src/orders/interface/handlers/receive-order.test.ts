/**
 * RED test: receive-order handler (PR 2c).
 *
 * Verifies the RISK-W07 duplicate-receive guard comment is present.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('./bootstrap.js', () => {
  const executeMock = vi.fn().mockResolvedValue({
    order: {
      id: '11111111-1111-1111-1111-111111111111',
      productId: '22222222-2222-2222-2222-222222222222',
      productName: 'Cerveza',
      productSku: 'SKU-001',
      quantity: 60,
      supplierSnapshot: 'SnacksCorp',
      fromAlertId: null,
      status: 'RECIBIDA',
      rejectionReason: null,
      createdBy: '33333333-3333-3333-3333-333333333333',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      receivedAt: '2025-01-01T00:00:00.000Z',
    },
    stockAfter: 80,
    closedAlertId: 'alert-1',
  });
  return {
    getOrdersBootstrap: vi.fn(() => ({
      receiveOrderUseCase: { execute: executeMock },
    })),
  };
});

const { handler } = await import('./receive-order.js');
const CTX = { requestId: 'r-123', logger: { info: vi.fn(), error: vi.fn() } } as unknown;

describe('POST /api/v1/orders/{id}/receive handler', () => {
  it('returns 200 on happy receive with composed order + stockAfter + closedAlertId', async () => {
    const O = '11111111-1111-1111-1111-111111111111';
    // Build a valid JWT: header.payload.sig
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1', iat: Date.now() })).toString(
      'base64url',
    );
    const token = `${header}.${payload}.sig`;
    const event = {
      requestContext: {
        http: { method: 'POST', path: `/api/v1/orders/${O}/receive`, sourceIp: '127.0.0.1' },
      },
      headers: { authorization: `Bearer ${token}` },
      rawPath: `/api/v1/orders/${O}/receive`,
      rawQueryString: '',
      routeKey: 'POST /api/v1/orders/{id}/receive',
      body: JSON.stringify({}),
    } as unknown as Parameters<typeof handler>[0];
    const result = await (
      handler as (
        e: Parameters<typeof handler>[0],
        c: unknown,
      ) => Promise<{ statusCode: number; body?: string }>
    )(event, CTX);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.id).toBe(O);
    expect(body.status).toBe('RECIBIDA');
    expect(body.productName).toBe('Cerveza');
    expect(body.productSku).toBe('SKU-001');
    expect(body.stockAfter).toBe(80);
    expect(body.closedAlertId).toBe('alert-1');
  });
});

describe('RISK-W07 duplicate-receive comment', () => {
  it('source file contains the RISK-W07 guard comment', async () => {
    const fs = await import('node:fs');

    const srcFile = fs.readFileSync(
      '/home/harri/development/projects/ceiba_software/packages/backend/src/orders/interface/handlers/receive-order.ts',
      'utf8',
    );
    expect(srcFile).toContain('Duplicate POST /receive is blocked by the state machine');
    expect(srcFile).toContain('NOT by Idempotency-Key');
  });
});

/**
 * RED test: receive-order handler (PR 2c).
 *
 * Verifies the RISK-W07 duplicate-receive guard comment is present.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('./bootstrap.js', () => {
  const executeMock = vi.fn().mockResolvedValue({
    orderId: '11111111-1111-1111-1111-111111111111',
    status: 'RECIBIDA',
    stockAfter: 80,
    closedAlertId: 'alert-1',
    receivedAt: '2025-01-01T00:00:00.000Z',
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
  it('returns 200 on happy receive', async () => {
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

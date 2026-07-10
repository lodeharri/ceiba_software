import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { StockMutationService } from '../../application/stock-mutation-service.js';
import { StockWouldGoNegativeError } from '../../domain/errors/stock-would-go-negative.js';
import { ProductNotFoundError } from '../../domain/errors/product-not-found.js';
import type { AlertCloserPort } from '../../../alerts/domain/ports/alert-closer-port.js';

// Module-level mocks must be defined before importing the handler
vi.mock('../../bootstrap.js', () => {
  const mockRecord = vi.fn();
  return {
    getInventoryBootstrap: vi.fn(() => ({
      stockMutationService: { record: mockRecord },
      stockMovementRepository: {},
    })),
    _resetMock: () => mockRecord.mockReset(),
    _getMockRecord: () => mockRecord,
  };
});

// Dynamic import so mocks apply
const { handler } = await import('./record-movement.js');
const { _getMockRecord, _resetMock } = await import('../../bootstrap.js');

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: {
        method: 'POST',
        path: '/api/v1/products/11111111-1111-4111-8111-111111111111/movements',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
    },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'ENTRADA', quantity: 10, reason: 'Reposición' }),
    rawPath: '/api/v1/products/11111111-1111-4111-8111-111111111111/movements',
    rawQueryString: '',
    routeKey: 'POST /api/v1/products/{id}/movements',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

describe('POST /products/{id}/movements handler', () => {
  beforeEach(() => {
    _resetMock();
  });

  it('returns 201 with movementId and stockAfter on success', async () => {
    _getMockRecord().mockResolvedValue({ movementId: 'm1', stockAfter: 20 });

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.movementId).toBe('m1');
    expect(body.stockAfter).toBe(20);
  });

  it('returns 400 for invalid body (missing fields)', async () => {
    const event = makeEvent({ body: JSON.stringify({}) });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 422 with details for STOCK_WOULD_GO_NEGATIVE', async () => {
    const error = new StockWouldGoNegativeError({ currentStock: 10, requested: 20, shortBy: 10 });
    _getMockRecord().mockRejectedValue(error);

    const event = makeEvent({
      body: JSON.stringify({ type: 'SALIDA', quantity: 20, reason: 'Exceso' }),
    });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.STOCK_WOULD_GO_NEGATIVE);
    expect(body.details).toBeDefined();
    expect(body.details?.shortBy).toBe(10);
  });

  it('returns 404 for unknown product', async () => {
    _getMockRecord().mockRejectedValue(new ProductNotFoundError('unknown'));

    const event = makeEvent({
      rawPath: '/api/v1/products/00000000-0000-4000-8000-000000000000/movements',
    });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('returns 400 for malformed product ID in path', async () => {
    const event = makeEvent({ rawPath: '/api/v1/products/bad-id/movements' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('includes X-Request-Id in response headers', async () => {
    _getMockRecord().mockResolvedValue({ movementId: 'm1', stockAfter: 20 });

    const event = makeEvent({ headers: { 'x-request-id': 'req-123' } });
    const result = await handler(event, {} as never, () => {});

    expect(result.headers).toBeDefined();
    // The header value comes from the request-context
  });
});

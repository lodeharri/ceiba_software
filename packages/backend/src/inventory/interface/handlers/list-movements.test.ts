import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

// Module-level mocks must be defined before importing the handler
vi.mock('../../bootstrap.js', () => {
  const mockListByProduct = vi.fn();
  return {
    getInventoryBootstrap: vi.fn(() => ({
      stockMutationService: {},
      stockMovementRepository: { listByProduct: mockListByProduct },
    })),
    _resetMock: () => mockListByProduct.mockReset(),
    _getMockList: () => mockListByProduct,
  };
});

const { handler } = await import('./list-movements.js');
const { _getMockList, _resetMock } = await import('../../bootstrap.js');

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: {
        method: 'GET',
        path: '/api/v1/products/11111111-1111-4111-8111-111111111111/movements',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
    },
    headers: {},
    body: null,
    rawPath: '/api/v1/products/11111111-1111-4111-8111-111111111111/movements',
    rawQueryString: '',
    routeKey: 'GET /api/v1/products/{id}/movements',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

describe('GET /products/{id}/movements handler', () => {
  beforeEach(() => {
    _resetMock();
  });

  it('returns 200 with page envelope on success', async () => {
    _getMockList().mockResolvedValue({
      items: [
        {
          id: 'm1',
          productId: 'p1',
          type: 'ENTRADA',
          quantity: 10,
          reason: 'Test',
          userId: 'u1',
          createdAt: '2026-07-09T10:00:00Z',
        },
      ],
      page: 1,
      size: 50,
      total: 1,
      hasMore: false,
    });

    const event = makeEvent();
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.items).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.size).toBe(50);
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('accepts custom page and size query params', async () => {
    _getMockList().mockResolvedValue({
      items: [],
      page: 2,
      size: 10,
      total: 0,
      hasMore: false,
    });

    const event = makeEvent({ rawQueryString: 'page=2&size=10' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.page).toBe(2);
    expect(body.size).toBe(10);
  });

  it('returns 400 for invalid size (out of range)', async () => {
    const event = makeEvent({ rawQueryString: 'size=300' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 400 for non-positive page', async () => {
    const event = makeEvent({ rawQueryString: 'page=0' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for malformed productId in path', async () => {
    const event = makeEvent({ rawPath: '/api/v1/products/bad/movements' });
    const result = await handler(event, {} as never, () => {});

    expect(result.statusCode).toBe(400);
  });
});

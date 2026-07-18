/**
 * Tests for semantic-search handler (Group 11).
 *
 * Strict TDD: RED first → GREEN → TRIANGULATE.
 *
 * Covers:
 * - Scenario 10.2: 400 on invalid body (q too short, missing q, limit > 50)
 * - Scenario 10.1: 200 happy path
 * - Scenario 10.3: 503 on EmbeddingProviderUnavailable
 * - JWT failure → 401
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// ── Event factory ──────────────────────────────────────────────────────────────

function makeEvent(
  body: unknown,
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: 'POST', path: '/api/v1/products/semantic-search', sourceIp: '127.0.0.1' },
      requestId: 'r-handler-test',
    },
    headers: {
      authorization:
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    rawPath: '/api/v1/products/semantic-search',
    rawQueryString: '',
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

// ── Stubs ──────────────────────────────────────────────────────────────────────

const STUB_VECTOR: readonly number[] = Object.freeze(
  Array.from({ length: 768 }, () => Math.random()),
);

const STUB_PRODUCT = {
  id: '00000000-0000-0000-0000-000000000001',
  sku: 'LAPTOP-001',
  name: 'Laptop Gamer',
  description: '16GB RAM',
  price: 1500000,
  stock: 10,
  stockMin: 5,
  categoryId: '00000000-0000-4000-8000-000000000001',
  supplier: 'ACME',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── JWT mock ───────────────────────────────────────────────────────────────────

vi.mock('../../../shared/jwt-middleware.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ sub: '33333333-3333-3333-3333-333333333333' }),
}));

// ── Bootstrap mock ─────────────────────────────────────────────────────────────

const mockEmbedder = {
  embed: vi.fn().mockResolvedValue(STUB_VECTOR),
  embedBatch: vi.fn(),
};

const mockSemanticSearchExecute = vi.fn().mockResolvedValue({
  items: [],
  total: 0,
});

const mockProductRepo = {
  findByEmbedding: vi
    .fn()
    .mockResolvedValue([
      STUB_PRODUCT,
      { ...STUB_PRODUCT, id: '00000000-0000-0000-0000-000000000002' },
    ]),
  updateEmbedding: vi.fn(),
  findById: vi.fn(),
  findBySku: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
};

vi.mock('../../bootstrap.js', () => ({
  getProductsBootstrap: vi.fn(() =>
    Promise.resolve({
      embeddingPort: mockEmbedder,
      productRepo: mockProductRepo,
      semanticSearch: {
        execute: mockSemanticSearchExecute,
      },
      createProduct: {},
      listProducts: {},
      getProduct: {},
      updateProduct: {},
      categoryReadRepository: {},
      db: {},
      logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
    }),
  ),
}));

// ── Handler import ─────────────────────────────────────────────────────────────

const { handler } = await import('./semantic-search-products.js');

const CTX = {
  requestId: 'r-handler-test',
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
} as unknown;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/products/semantic-search handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockEmbedder.embed).mockResolvedValue(STUB_VECTOR);
    vi.mocked(mockProductRepo.findByEmbedding).mockResolvedValue([
      STUB_PRODUCT,
      { ...STUB_PRODUCT, id: '00000000-0000-0000-0000-000000000002' },
    ]);
  });

  describe('Scenario 10.2 — 400 on invalid body', () => {
    it('returns 400 when q is too short (< 3 chars)', async () => {
      const event = makeEvent({ q: 'ab' });
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body ?? '{}');
      expect(body.code).toBe('INVALID_SEMANTIC_SEARCH_QUERY');
    });

    it('returns 400 when q is missing', async () => {
      const event = makeEvent({});
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body ?? '{}');
      expect(body.code).toBe('INVALID_SEMANTIC_SEARCH_QUERY');
    });

    it('returns 400 when limit exceeds 50', async () => {
      const event = makeEvent({ q: 'laptop gaming', limit: 200 });
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body ?? '{}');
      expect(body.code).toBe('INVALID_SEMANTIC_SEARCH_QUERY');
    });

    it('returns 400 when limit is less than 1', async () => {
      const event = makeEvent({ q: 'laptop gaming', limit: 0 });
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body ?? '{}');
      expect(body.code).toBe('INVALID_SEMANTIC_SEARCH_QUERY');
    });
  });

  describe('Scenario 10.1 — 200 happy path', () => {
    it('returns 200 with items and total', async () => {
      const event = makeEvent({ q: 'laptop gaming', limit: 5 });
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body ?? '{}');
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('calls semanticSearch.execute with correct args', async () => {
      const event = makeEvent({ q: 'laptop gaming', limit: 5 });
      await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(mockSemanticSearchExecute).toHaveBeenCalledWith({ query: 'laptop gaming', limit: 5 });
    });

    it('uses default limit of 10 when not provided', async () => {
      const event = makeEvent({ q: 'laptop gaming' });
      await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(mockSemanticSearchExecute).toHaveBeenCalledWith({ query: 'laptop gaming', limit: 10 });
    });
  });

  describe('Scenario 10.3 — 503 on EmbeddingProviderUnavailable', () => {
    it('returns 503 with code and retryAfter when semanticSearch fails', async () => {
      const { EmbeddingProviderUnavailableError } =
        await import('../../domain/errors/embedding-provider-unavailable.js');
      mockSemanticSearchExecute.mockRejectedValue(
        new EmbeddingProviderUnavailableError('gemini', 'HTTP 500'),
      );
      const event = makeEvent({ q: 'laptop gaming', limit: 5 });
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      expect(result.statusCode).toBe(503);
      const body = JSON.parse(result.body ?? '{}');
      expect(body.code).toBe('EMBEDDING_PROVIDER_UNAVAILABLE');
      expect(body.details?.provider).toBe('gemini');
      expect(body.details?.retryAfter).toBe(60);
    });
  });

  describe('JWT failure path', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const { UnauthorizedError } = await import('../../../shared/errors/typed-errors.js');
      vi.mocked(await import('../../../shared/jwt-middleware.js')).verifyJwt.mockRejectedValueOnce(
        new UnauthorizedError('INVALID_TOKEN', 'Missing Bearer token'),
      );
      const event = makeEvent({ q: 'laptop' }, { headers: {} });
      const result = await (
        handler as (
          e: APIGatewayProxyEventV2,
          c: unknown,
        ) => Promise<{ statusCode: number; body?: string }>
      )(event, CTX);
      // UnauthorizedError maps to 401
      expect(result.statusCode).toBe(401);
    });
  });
});

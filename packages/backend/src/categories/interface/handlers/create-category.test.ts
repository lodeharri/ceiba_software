import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
/**
 * RED-first handler test for `POST /api/v1/categories` (PR 2a).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { CreateCategoryUseCase } from '../../application/create-category.js';
import { CategoryAlreadyExistsError } from '../../domain/errors/category-already-exists.js';

const mockExecute = vi.fn();
const mockGetCategoriesBootstrap = vi.fn(() => ({
  createCategory: { execute: mockExecute } as unknown as CreateCategoryUseCase,
}));

// Mock JWT verification for handler tests
vi.mock('../../../shared/jwt-middleware.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ sub: '33333333-3333-3333-3333-333333333333' }),
}));

vi.mock('../../bootstrap.js', () => ({
  getCategoriesBootstrap: () => mockGetCategoriesBootstrap(),
}));

const importHandler = async () => (await import('./create-category.js')).handler;

type JsonResult = { statusCode: number; body: string; headers?: Record<string, string> };
function asJson(r: APIGatewayProxyResultV2): JsonResult {
  if (typeof r === 'string') return { statusCode: 200, body: r };
  return r as JsonResult;
}

function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /api/v1/categories',
    rawPath: '/api/v1/categories',
    rawQueryString: '',
    headers: {
      authorization: `Bearer header.eyJzdWIiOiAiMzMzMzMzMzMtMzMzMy0zMzMzLTMzMzMtMzMzMzMzMzMzMzMzIiwgImV4cCI6IDk5OTk5OTk5OTl9.signature`,
    },
    requestContext: {
      http: {
        method: 'POST',
        path: '/api/v1/categories',
        protocol: 'HTTP/1.1',
        sourceIp: '203.0.113.5',
      },
      routeKey: 'POST /api/v1/categories',
      accountId: '000000000000',
      apiId: 'test-api',
      domainName: 'test-api.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test-api',
      stage: '$default',
      requestId: 'lambda-req-cat-create',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const lambdaCtx = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'products-lambda',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:products-lambda',
  memoryLimitInMB: '512',
  awsRequestId: 'lambda-req-cat-create',
  logGroupName: '/aws/lambda/products-lambda',
  logStreamName: '2026/01/01/[$LATEST]abcdef',
  getRemainingTimeInMillis: () => 10000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
} as unknown as LambdaContext;

describe('POST /api/v1/categories handler', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with the new category on valid input', async () => {
    mockExecute.mockResolvedValueOnce({
      toReadModel: () => ({
        id: 'cat-new',
        name: 'Bebidas',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    const handler = await importHandler();
    const result = asJson(
      await handler(makeEvent({ name: 'Bebidas' }), lambdaCtx, () => undefined),
    );
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.name).toBe('Bebidas');
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute.mock.calls[0]![0]).toEqual({ name: 'Bebidas' });
  });

  it('returns 409 when the use case throws CategoryAlreadyExistsError', async () => {
    mockExecute.mockRejectedValueOnce(new CategoryAlreadyExistsError('Bebidas', 'cat-1'));
    const handler = await importHandler();
    const result = asJson(
      await handler(makeEvent({ name: 'Bebidas' }), lambdaCtx, () => undefined),
    );
    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('CATEGORY_NAME_EXISTS');
  });

  it('returns 400 when name is shorter than 2 chars', async () => {
    const handler = await importHandler();
    const result = asJson(await handler(makeEvent({ name: 'A' }), lambdaCtx, () => undefined));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is missing the name field', async () => {
    const handler = await importHandler();
    const result = asJson(await handler(makeEvent({}), lambdaCtx, () => undefined));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

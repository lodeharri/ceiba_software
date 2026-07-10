/**
 * RED-first handler test for `GET /api/v1/categories` (PR 2a).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { ListCategoriesUseCase } from '../../application/list-categories.js';

const mockExecute = vi.fn();
const mockGetCategoriesBootstrap = vi.fn(() => ({
  listCategories: { execute: mockExecute } as unknown as ListCategoriesUseCase,
}));

vi.mock('../../bootstrap.js', () => ({ getCategoriesBootstrap: () => mockGetCategoriesBootstrap() }));

const importHandler = async () => (await import('./list-categories.js')).handler;

type JsonResult = { statusCode: number; body: string; headers?: Record<string, string> };
function asJson(r: APIGatewayProxyResultV2): JsonResult {
  if (typeof r === 'string') return { statusCode: 200, body: r };
  return r as JsonResult;
}

function makeEvent(): import('aws-lambda').APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /api/v1/categories',
    rawPath: '/api/v1/categories',
    rawQueryString: '',
    headers: {},
    requestContext: {
      http: {
        method: 'GET',
        path: '/api/v1/categories',
        protocol: 'HTTP/1.1',
        sourceIp: '203.0.113.5',
      },
      routeKey: 'GET /api/v1/categories',
      accountId: '000000000000',
      apiId: 'test-api',
      domainName: 'test-api.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test-api',
      stage: '$default',
      requestId: 'lambda-req-cat-list',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    body: undefined,
    isBase64Encoded: false,
  } as unknown as import('aws-lambda').APIGatewayProxyEventV2;
}

const lambdaCtx = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'products-lambda',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:products-lambda',
  memoryLimitInMB: '512',
  awsRequestId: 'lambda-req-cat-list',
  logGroupName: '/aws/lambda/products-lambda',
  logStreamName: '2026/01/01/[$LATEST]abcdef',
  getRemainingTimeInMillis: () => 10000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
} as unknown as import('aws-lambda').Context;

describe('GET /api/v1/categories handler', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with the categories envelope', async () => {
    mockExecute.mockResolvedValueOnce([
      { toReadModel: () => ({ id: 'cat-1', name: 'Bebidas', createdAt: '2026-01-01T00:00:00.000Z' }) },
      { toReadModel: () => ({ id: 'cat-2', name: 'Snacks', createdAt: '2026-01-01T00:00:00.000Z' }) },
    ]);
    const handler = await importHandler();
    const result = asJson(await handler(makeEvent(), lambdaCtx, () => undefined));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].name).toBe('Bebidas');
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
  });

  it('returns 200 with an empty items array when no categories exist', async () => {
    mockExecute.mockResolvedValueOnce([]);
    const handler = await importHandler();
    const result = asJson(await handler(makeEvent(), lambdaCtx, () => undefined));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});
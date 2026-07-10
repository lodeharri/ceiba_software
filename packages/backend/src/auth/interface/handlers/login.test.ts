import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { LoginUseCase } from '../../application/login.js';

const mockExecute = vi.fn();
const mockGetAuthBootstrap = vi.fn(() => ({
  loginUseCase: { execute: mockExecute } as unknown as LoginUseCase,
}));

vi.mock('../../bootstrap.js', () => ({ getAuthBootstrap: () => mockGetAuthBootstrap() }));

const importHandler = async () => (await import('./login.js')).handler;

type JsonResult = { statusCode: number; body: string; headers?: Record<string, string> };

function asJson(result: APIGatewayProxyResultV2): JsonResult {
  if (typeof result === 'string') {
    return { statusCode: 200, body: result };
  }
  return result as JsonResult;
}

describe('POST /api/v1/auth/login handler', () => {
  beforeEach(() => {
    process.env['TRUSTED_PROXY_DEPTH'] = '0';
    process.env['JWT_SECRET'] = 'integration-test-secret-at-least-32-bytes-long';
    mockExecute.mockReset();
  });
  afterEach(() => {
    delete process.env['TRUSTED_PROXY_DEPTH'];
  });

  function makeEvent(body: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
    return {
      version: '2.0',
      routeKey: 'POST /api/v1/auth/login',
      rawPath: '/api/v1/auth/login',
      rawQueryString: '',
      headers: { 'content-type': 'application/json', ...headers },
      requestContext: {
        http: {
          method: 'POST',
          path: '/api/v1/auth/login',
          protocol: 'HTTP/1.1',
          sourceIp: '203.0.113.5',
        },
        routeKey: 'POST /api/v1/auth/login',
        accountId: '000000000000',
        apiId: 'test-api',
        domainName: 'test-api.execute-api.us-east-1.amazonaws.com',
        domainPrefix: 'test-api',
        stage: '$default',
        requestId: 'lambda-req-123',
        time: '01/Jan/2026:00:00:00 +0000',
        timeEpoch: 0,
      },
      body: JSON.stringify(body),
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;
  }

  const lambdaCtx = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'auth-lambda',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:auth-lambda',
    memoryLimitInMB: '512',
    awsRequestId: 'lambda-req-123',
    logGroupName: '/aws/lambda/auth-lambda',
    logStreamName: '2026/01/01/[$LATEST]abcdef',
    getRemainingTimeInMillis: () => 10000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  } as unknown as LambdaContext;

  it('returns 200 with the JWT envelope on valid credentials', async () => {
    mockExecute.mockResolvedValueOnce({
      token: 'signed(...)',
      expiresAt: '2026-01-02T00:00:00.000Z',
      user: { id: '11111111-1111-4111-8111-111111111111', username: 'admin', role: 'admin' },
    });
    const handler = await importHandler();
    const result = asJson(
      await handler(
        makeEvent({ username: 'admin', password: 'secret-1234' }),
        lambdaCtx,
        () => undefined,
      ),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.token).toBe('signed(...)');
    expect(body.user.username).toBe('admin');
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute.mock.calls[0]![0].ip).toBe('203.0.113.5');
  });

  it('returns 401 when the use case throws InvalidCredentialsError', async () => {
    const err = (await import('../../domain/errors/invalid-credentials.js'))
      .InvalidCredentialsError;
    mockExecute.mockRejectedValueOnce(new err());
    const handler = await importHandler();
    const result = asJson(
      await handler(
        makeEvent({ username: 'admin', password: 'wrong' }),
        lambdaCtx,
        () => undefined,
      ),
    );
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.message).toBe('Credenciales inválidas.');
  });

  it('returns 429 when the use case throws RateLimitExceededError', async () => {
    const err = (await import('../../domain/errors/rate-limit-exceeded.js')).RateLimitExceededError;
    mockExecute.mockRejectedValueOnce(new err(900));
    const handler = await importHandler();
    const result = asJson(
      await handler(
        makeEvent({ username: 'admin', password: 'secret-1234' }),
        lambdaCtx,
        () => undefined,
      ),
    );
    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.details.retryAfterSeconds).toBe(900);
  });

  it('returns 400 when Zod rejects the body', async () => {
    const handler = await importHandler();
    const result = asJson(await handler(makeEvent({ username: 'ab' }), lambdaCtx, () => undefined));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

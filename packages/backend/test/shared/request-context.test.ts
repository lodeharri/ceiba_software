/**
 * RED-first test for request-context (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - withRequestContext generates a UUID v4 if X-Request-Id missing.
 *   - withRequestContext echoes the incoming X-Request-Id when present.
 *   - The wrapped handler receives the context with bound logger + requestId.
 */

import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const UUID_V4_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function buildEvent(headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /healthz',
    rawPath: '/healthz',
    rawQueryString: '',
    headers,
    requestContext: {
      accountId: '000000000000',
      apiId: 'api-id',
      domainName: 'api.example.test',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/healthz',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'req-1',
      routeKey: 'GET /healthz',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    body: '',
    isBase64Encoded: false,
  };
}

describe('withRequestContext', () => {
  it('generates a UUID v4 when X-Request-Id is missing', async () => {
    const { withRequestContext } = await import('../../src/shared/request-context.js');

    const handler = withRequestContext(async (_event, ctx): Promise<APIGatewayProxyResultV2> => ({
      statusCode: 200,
      body: JSON.stringify({ requestId: ctx.requestId }),
    }));

    const result = await handler(buildEvent({}), {} as never, () => {});
    const body = JSON.parse(result.body) as { requestId: string };

    expect(body.requestId).toMatch(UUID_V4_REGEX);
  });

  it('echoes the incoming X-Request-Id when present', async () => {
    const { withRequestContext } = await import('../../src/shared/request-context.js');

    const handler = withRequestContext(async (_event, ctx): Promise<APIGatewayProxyResultV2> => ({
      statusCode: 200,
      body: JSON.stringify({ requestId: ctx.requestId }),
    }));

    const result = await handler(
      buildEvent({ 'x-request-id': 'r-fixed-123' }),
      {} as never,
      () => {},
    );
    const body = JSON.parse(result.body) as { requestId: string };

    expect(body.requestId).toBe('r-fixed-123');
  });

  it('binds a logger to the context', async () => {
    const { withRequestContext } = await import('../../src/shared/request-context.js');

    const handler = withRequestContext(async (_event, ctx): Promise<APIGatewayProxyResultV2> => {
      expect(ctx.logger).toBeDefined();
      expect(typeof ctx.logger.info).toBe('function');
      return { statusCode: 200, body: '{}' };
    });

    await handler(buildEvent({}), {} as never, () => {});
  });
});

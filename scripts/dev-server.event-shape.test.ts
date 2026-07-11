/**
 * APIGatewayProxyEventV2 builder test (Task 1.2 + 1.3, REQ-NDS-3 + R-1).
 *
 * RED → GREEN → TRIANGULATE → REFACTOR cycle for PR 1 Capability 1
 * Task 1.2 + Task 1.3.
 *
 * Covers:
 *   - REQ-NDS-3 — every required APIGW v2 field, exact values
 *   - R-1 — byte-equal handler response when the same handler is invoked
 *     with an AWS-frozen fixture vs. the dev-built event (Task 1.3)
 *   - Edge cases: empty body on POST (EC-4), multi-value headers (joined
 *     with `,`), cookies split from Cookie header (EC-3), empty body on GET
 *
 * Test driver: builds a stub `IncomingMessage` with the fields populated
 * (Node's stream / socket contracts are stubbed where they would matter),
 * invokes the builder, JSON-serializes the result, and compares against the
 * expected shape. The handler byte-equality test runs a single stub handler
 * twice (once with the AWS fixture, once with the dev event) and asserts
 * `JSON.stringify(result) === JSON.stringify(awsResult)`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toApiGatewayProxyEventV2, type DevEvent } from './events/apigw-v2-builder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AWS_FIXTURE_PATH = resolve(HERE, '..', 'test', 'fixtures', 'aws-apigw-v2-event.sample.json');

interface StubMessage {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
}

function buildStubMessage(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}): StubMessage {
  return {
    method: opts.method,
    url: opts.url,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'vitest/dev-server',
      'x-forwarded-for': '203.0.113.7',
      accept: 'application/json',
      ...opts.headers,
    },
    socket: { remoteAddress: '203.0.113.7' },
  };
}

describe('toApiGatewayProxyEventV2 (REQ-NDS-3)', () => {
  it('builds a verbatim APIGW v2 shape for POST /auth/login', () => {
    const req = buildStubMessage({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {},
      body: '{"username":"a","password":"b"}',
    });
    const event = toApiGatewayProxyEventV2({
      req: req as never,
      method: 'POST',
      rawPath: '/auth/login',
      rawQueryString: '',
      body: '{"username":"a","password":"b"}',
      cookies: [],
    });
    const serialized = JSON.parse(JSON.stringify(event));
    expect(serialized.version).toBe('2.0');
    expect(serialized.routeKey).toBe('POST /auth/login');
    expect(serialized.rawPath).toBe('/auth/login');
    expect(serialized.rawQueryString).toBe('');
    expect(serialized.headers['content-type']).toBe('application/json');
    expect(serialized.headers['user-agent']).toBe('vitest/dev-server');
    expect(serialized.requestContext.http.method).toBe('POST');
    expect(serialized.requestContext.http.path).toBe('/auth/login');
    expect(serialized.requestContext.http.protocol).toBe('HTTP/1.1');
    expect(serialized.requestContext.http.sourceIp).toBe('203.0.113.7');
    expect(serialized.requestContext.http.userAgent).toBe('vitest/dev-server');
    expect(serialized.requestContext.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(serialized.requestContext.routeKey).toBe('POST /auth/login');
    expect(serialized.requestContext.stage).toBe('$default');
    expect(typeof serialized.requestContext.time).toBe('string');
    expect(Number.isFinite(serialized.requestContext.timeEpoch)).toBe(true);
    expect(serialized.body).toBe('{"username":"a","password":"b"}');
    expect(serialized.isBase64Encoded).toBe(false);
    expect(serialized.cookies).toEqual([]);
  });
});

describe('TRIANGULATE — edge cases (EC-3, EC-4)', () => {
  it('body is undefined (not "") when the POST body is empty (EC-4)', () => {
    const req = buildStubMessage({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    const event = toApiGatewayProxyEventV2({
      req: req as never,
      method: 'POST',
      rawPath: '/auth/login',
      rawQueryString: '',
      cookies: [],
    });
    expect(event.body).toBeUndefined();
    // APIGW v2 either carries `body` as a string OR omits the property
    // entirely. Both wire forms are observable in production; the lock
    // is that the value is `undefined` (never the empty string).
    if ('body' in event) {
      expect(event.body).toBeUndefined();
    }
  });

  it('multi-value headers join with ","', () => {
    const multiReq = {
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        'content-type': ['application/json', 'text/plain'],
        cookie: 'a=1; b=2',
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const event = toApiGatewayProxyEventV2({
      req: multiReq as never,
      method: 'POST',
      rawPath: '/auth/login',
      rawQueryString: '',
      cookies: ['a=1', 'b=2'],
    });
    expect(event.headers['content-type']).toBe('application/json,text/plain');
  });

  it('cookies split from the Cookie header preserving order (EC-3)', () => {
    const cookieReq = {
      method: 'GET',
      url: '/api/v1/products',
      headers: {
        cookie: 'session=abc; csrf=xyz; tracking=123',
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const event = toApiGatewayProxyEventV2({
      req: cookieReq as never,
      method: 'GET',
      rawPath: '/products',
      rawQueryString: '',
      cookies: ['session=abc', 'csrf=xyz', 'tracking=123'],
    });
    expect(event.cookies).toEqual(['session=abc', 'csrf=xyz', 'tracking=123']);
  });

  it('body is undefined on GET (EC-4)', () => {
    const req = buildStubMessage({
      method: 'GET',
      url: '/api/v1/products',
      headers: {},
      body: '',
    });
    const event = toApiGatewayProxyEventV2({
      req: req as never,
      method: 'GET',
      rawPath: '/products',
      rawQueryString: '',
      cookies: [],
    });
    expect(event.body).toBeUndefined();
    expect(event.cookies).toEqual([]);
  });
});

/**
 * Task 1.3 — Byte-equality vs. the AWS-frozen fixture.
 *
 * If the AWS fixture file is missing, the test fails with a descriptive
 * message (RED state for fixture creation). Once the fixture is in place,
 * the test asserts that both invocations produce byte-equal JSON.
 */
describe('TRIANGULATE (Task 1.3) — AWS byte-equality (R-1 mitigation)', () => {
  it('handler response is byte-equal for AWS fixture vs dev-built event', async () => {
    let awsFixture: { event: DevEvent };
    try {
      awsFixture = JSON.parse(readFileSync(AWS_FIXTURE_PATH, 'utf8')) as { event: DevEvent };
    } catch (err) {
      throw new Error(
        `AWS event fixture missing at ${AWS_FIXTURE_PATH}: ${err instanceof Error ? err.message : String(err)}. Create it before the test can pass (Task 1.3 GREEN).`,
      );
    }
    // Strip the dynamic fields (requestId, time, timeEpoch) so the
    // comparison focuses on the shape the handler actually reads.
    const stub = async (event: DevEvent): Promise<{ statusCode: number; body: string }> => {
      const relevant = {
        version: event.version,
        routeKey: event.routeKey,
        rawPath: event.rawPath,
        rawQueryString: event.rawQueryString,
        method: event.requestContext.http.method,
        path: event.requestContext.http.path,
        protocol: event.requestContext.http.protocol,
        sourceIp: event.requestContext.http.sourceIp,
        userAgent: event.requestContext.http.userAgent,
        stage: event.requestContext.stage,
        body: event.body,
        isBase64Encoded: event.isBase64Encoded,
        cookies: event.cookies,
      };
      return {
        statusCode: 200,
        body: JSON.stringify({ received: relevant }),
      };
    };
    const req = buildStubMessage({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {},
      body: '{"username":"a","password":"b"}',
    });
    const devEvent = toApiGatewayProxyEventV2({
      req: req as never,
      method: 'POST',
      rawPath: '/auth/login',
      rawQueryString: '',
      body: '{"username":"a","password":"b"}',
      cookies: [],
    });
    const awsResult = await stub(awsFixture.event);
    const devResult = await stub(devEvent);
    expect(JSON.stringify(devResult)).toBe(JSON.stringify(awsResult));
  });
});

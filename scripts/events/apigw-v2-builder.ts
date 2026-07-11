/**
 * APIGatewayProxyEventV2 builder (Task 1.2).
 *
 * Pure, project-local builder for the dev server's request → event
 * conversion. Lives in `scripts/events/` so the byte-equality test
 * (`scripts/dev-server.event-shape.test.ts`) can exercise it without
 * standing up the full server.
 *
 * Field set is locked by REQ-NDS-3. The byte-equality test (Task 1.3)
 * cross-checks this builder against a frozen AWS-captured event payload.
 *
 * Implementation note: types are intentionally LOCAL to this module so
 * the dev server does not depend on `@types/aws-lambda` (those types live
 * in `packages/infra/node_modules/@types/aws-lambda` and pnpm does not
 * hoist them to the workspace root).
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface DevEvent {
  version: '2.0';
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  requestContext: {
    http: {
      method: string;
      path: string;
      protocol: 'HTTP/1.1';
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: '$default';
    time: string;
    timeEpoch: number;
  };
  body?: string;
  isBase64Encoded: false;
  cookies: string[];
}

/** Lowercase the header keys; join multi-value with `,` like APIGW v2 does. */
export function headersToRecord(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const lc = k.toLowerCase();
    if (Array.isArray(v)) out[lc] = v.join(',');
    else out[lc] = v;
  }
  return out;
}

export function parseCookies(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export interface ApiGatewayProxyEventArgs {
  req: IncomingMessage;
  method: string;
  /** APIGW v2-style raw path (no `/api/v1` prefix). Mirrors the AWS payload. */
  rawPath: string;
  /** Full path the client requested (with `/api/v1` prefix). PR 4: `routeKey`
   *  MUST include the prefix so the per-BC dispatchers in
   *  `packages/backend/src/shared/dispatchers/*` (which key their `ROUTES`
   *  tables with the prefix) can match the invocation. */
  fullPath?: string;
  rawQueryString: string;
  body?: string;
  cookies: string[];
}

export function toApiGatewayProxyEventV2(args: ApiGatewayProxyEventArgs): DevEvent {
  const { req, method, rawPath, rawQueryString, body, cookies } = args;
  const fullPath = args.fullPath ?? rawPath;
  const headers = headersToRecord(req.headers);
  const userAgent = headers['user-agent'] ?? 'unknown';
  const sourceIp =
    (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress) || '127.0.0.1';
  const now = new Date();
  // PR 4: routeKey carries the prefixed fullPath so the BC dispatchers can
  // match their ROUTES tables. rawPath stays prefix-stripped to mirror the
  // AWS APIGW v2 wire format.
  const routeKey = `${method} ${fullPath}`;
  const event: DevEvent = {
    version: '2.0',
    routeKey,
    rawPath,
    rawQueryString,
    headers,
    requestContext: {
      http: {
        method,
        // AWS wire format mirrors `rawPath` (prefix-stripped). Only
        // `routeKey` carries the prefixed fullPath because the per-BC
        // dispatchers key their `ROUTES` tables on the prefix.
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp,
        userAgent,
      },
      requestId: randomUUID(),
      routeKey,
      stage: '$default',
      time: now.toISOString(),
      timeEpoch: now.getTime(),
    },
    isBase64Encoded: false,
    cookies,
  };
  if (body !== undefined) {
    event.body = body;
  }
  return event;
}

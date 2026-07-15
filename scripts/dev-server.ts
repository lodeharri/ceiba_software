#!/usr/bin/env npx tsx
/**
 * Native dev server for MercadoExpress (PR 1, replace-localstack-dev-server).
 *
 * Replaces `docker/deployer/` + `docker/s3-proxy/` with the smallest possible
 * `node:http` wrapper around the REAL Lambda handlers that already ship in
 * `packages/infra/src/stacks/ApiStack.ts → LAMBDAS`.
 *
 * Why this exists:
 *   - LocalStack Community 3.4 emulates AWS-managed APIs (S3, SQS, SNS, ...),
 *     but the `apigateway` + `lambda` services were never reliable enough to
 *     trust the dev story on. The wrapper here invokes the real handler over
 *     the same `APIGatewayProxyEventV2` AWS produces at the edge.
 *   - The router reads from the SAME `LAMBDAS` constant CDK uses in
 *     production. There is no parallel route map (REQ-NDS-2, locked by
 *     `scripts/dev-server.test.ts → source invariants`).
 *
 * Module anatomy (design.md section 3):
 *   - `createDevServer({ lambdas, port })` builds a `http.Server` whose
 *     request handler mounts everything under `/api/v1` and:
 *       - CORS preflight (REQ-NDS-7) precedes route matching
 *       - /api/v1/health short-circuit (REQ-NDS-8) — no Lambda
 *       - 404 ROUTE_NOT_REGISTERED envelope (REQ-NDS-6) for unknown routes
 *       - body-size gate before read (REQ-NDS-9 EC-1)
 *       - method allowlist → 405 (REQ-NDS-9 EC-5)
 *       - matchRoute → invokeHandler → writeResponse (REQ-NDS-2, NDS-3, NDS-4)
 *       - handler throws → 500 DEV_SERVER_ERROR + stderr stack (REQ-NDS-5)
 *       - graceful shutdown on SIGINT / SIGTERM (REQ-NDS-9)
 *   - `boot()` is the CLI entry — flattens `LAMBDAS` (CDK shape) into
 *     `LambdaSpecForDev[]`, dynamically imports each handler `entry`,
 *     then `createDevServer({ lambdas, port }).listen()`.
 *
 * Runtime cost = 0 npm deps beyond Node built-ins (`node:http`,
 * `node:crypto`, `node:url`) and `@mercadoexpress/infra` for the route
 * table.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { existsSync } from 'node:fs';

// PR 4 fix (defect C): the dev server did not load `.env.dev` automatically,
// so handlers returning PrismaClient (`new PrismaClient()`) failed with
// `DATABASE_URL is undefined`. We resolve env in this priority order, all
// before any userland import that reads process.env at module top:
//   1. `.env.dev`           — developer's local override
//   2. `.env.dev.example`   — project-locked defaults committed to git
//   3. (fallback handled by `dotenv/config`'s built-in default of `.env`)
// `dotenv/config` itself populates `process.env` from `.env` if no overrides
// are set; explicit calls above take precedence (later writes win).
import { config as loadDotenv } from 'dotenv';
if (existsSync('.env.dev')) {
  loadDotenv({ path: '.env.dev' });
} else if (existsSync('.env.dev.example')) {
  loadDotenv({ path: '.env.dev.example' });
} else {
  // No project env file at all — fall back to dotenv's default `.env`.
  loadDotenv();
}

import { LAMBDAS } from '@mercadoexpress/infra';

// ---------------------------------------------------------------------------
// Public types — the boundary between the dev server and the rest of the
// world (tests, future consumers).
// ---------------------------------------------------------------------------

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
    stage: '$default';
    time: string;
    timeEpoch: number;
  };
  body?: string;
  isBase64Encoded: false;
  cookies: string[];
}

export interface DevContext {
  requestId: string;
  functionName: string;
  callbackWaitsForEmptyEventLoop: boolean;
  getRemainingTimeInMillis: () => number;
}

export interface DevResult {
  statusCode: number;
  headers?: Record<string, string | number | boolean>;
  body?: string;
  cookies?: string[];
  isBase64Encoded?: boolean;
}

export type DevHandler = (event: DevEvent, context: DevContext) => Promise<DevResult> | DevResult;

/**
 * Flat spec the dev server consumes: one entry per (method, path) pair.
 * The real `LambdaSpec` from `@mercadoexpress/infra` is CDK-shaped
 * (`{ id, functionName, entry, routes: [{ path, methods }] }`);
 * `boot()` flattens it into this shape after dynamically importing each
 * `entry`.
 */
export interface LambdaSpecForDev {
  routeKey: string;
  functionName: string;
  handler: DevHandler;
}

export interface CreateDevServerOptions {
  lambdas: ReadonlyArray<LambdaSpecForDev>;
  port?: number;
}

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

const API_PREFIX = '/api/v1';
const DEFAULT_PORT = 3001;
const MAX_BODY_DEFAULT = 1_048_576; // 1 MiB (REQ-NDS-9 EC-1)
const MAX_BODY_FLOOR = MAX_BODY_DEFAULT;
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_METHOD_LIST = ALLOW_METHODS.split(', ');
const ALLOW_HEADERS = 'Authorization, Content-Type, Idempotency-Key, X-Request-Id';

// ---------------------------------------------------------------------------
// Pure helpers — no IO. Extracted during REFACTOR step.
// ---------------------------------------------------------------------------

export function resolvePort(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const env = process.env.PORT?.trim();
  if (env && /^\d+$/.test(env)) {
    const parsed = Number(env);
    if (parsed > 0) return parsed;
  }
  return DEFAULT_PORT;
}

export function bindAddress(): '127.0.0.1' {
  // REQ-NDS NFR-5 — localhost only. A future `HOST=0.0.0.0` opt-in lives
  // here in the same place.
  return '127.0.0.1';
}

export function resolveMaxBody(envValue: string | undefined): { value: number; clamped: boolean } {
  if (envValue === undefined || envValue === '') {
    return { value: MAX_BODY_DEFAULT, clamped: false };
  }
  const raw = Number(envValue);
  // Spec R-8: any non-positive value (0, negative, NaN) is treated as a
  // mis-set configuration. We clamp to the floor and flag `clamped: true` so
  // operators see a one-time WARN at boot (per design.md §10). This avoids a
  // silent refusal of every request body when `DEV_SERVER_MAX_BODY_BYTES=0`
  // is accidentally set.
  if (!Number.isFinite(raw) || raw < MAX_BODY_FLOOR) {
    return { value: MAX_BODY_FLOOR, clamped: true };
  }
  return { value: Math.floor(raw), clamped: false };
}

export function corsPreflightHeaders(): Record<string, string> {
  // REQ-NDS-7 — wildcard `*` is mandated by the native-dev-server spec
  // (mirror of APIGW v2's default SPA preflight policy for a localhost-only
  // dev environment). Production CORS lives in the API Gateway HTTP API v2
  // CORS policy (out of scope for this file).

  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Content-Length': '0',
  };
}

export function toErrorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DevResult {
  const status =
    code === 'METHOD_NOT_ALLOWED'
      ? 405
      : code === 'PAYLOAD_TOO_LARGE'
        ? 413
        : code === 'ROUTE_NOT_REGISTERED'
          ? 404
          : 500;
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(details === undefined ? { code, message } : { code, message, details }),
    isBase64Encoded: false,
  };
}
// Re-export from the canonical apigw-v2-builder module (Task 1.2
// GREEN refactor — moved here to make the byte-equality test trivial).
// Both an internal `import` and an external `export` are needed so the
// helper names are visible to the rest of this file AND available to
// external consumers via `import ... from './dev-server.js'`.
import {
  parseCookies,
  toApiGatewayProxyEventV2,
  headersToRecord,
  type ApiGatewayProxyEventArgs,
} from './events/apigw-v2-builder.js';
export { toApiGatewayProxyEventV2, headersToRecord, parseCookies, type ApiGatewayProxyEventArgs };

export function pathToRegex(routeKey: string): RegExp {
  // Substitute `{name}` placeholders with a sentinel, escape every other
  // regex metachar in the literal segments, then swap the sentinel back
  // for `[^/]+`. Mirrors API Gateway path-parameter expansion so the
  // dev-server matches `/api/v1/products/<uuid>/movements` against the
  // registered route `GET /api/v1/products/{id}/movements`.
  const sentinel = '\x00PLACEHOLDER\x00';
  const parts: string[] = [];
  let lastIndex = 0;
  const placeholderRe = /\{[^}]+\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholderRe.exec(routeKey)) !== null) {
    parts.push(routeKey.slice(lastIndex, match.index));
    parts.push(sentinel);
    lastIndex = match.index + match[0].length;
  }
  parts.push(routeKey.slice(lastIndex));
  const escaped = parts
    .map((p) => (p === sentinel ? sentinel : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const pattern = escaped.split(sentinel).join('[^/]+');
  return new RegExp(`^${pattern}$`);
}

export function matchRoute(
  lambdas: ReadonlyArray<LambdaSpecForDev>,
  method: string,
  fullPath: string,
): LambdaSpecForDev | null {
  // REQ-NDS-2: match against the FULL path the client requested (the
  // production `LAMBDAS` shape stores `routeKey` as `<METHOD> <path>`
  // including the `/api/v1` prefix).
  const target = `${method} ${fullPath}`;
  for (const lambda of lambdas) {
    if (lambda.routeKey === target) return lambda;
    const spaceIdx = lambda.routeKey.indexOf(' ');
    const lambdaMethod = spaceIdx > 0 ? lambda.routeKey.slice(0, spaceIdx) : '';
    if (lambdaMethod === method && pathToRegex(lambda.routeKey).test(target)) {
      return lambda;
    }
  }
  return null;
}

export function buildDevServerError(requestId: string, error: unknown): DevResult {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : message;
  process.stderr.write(
    `[dev-server] uncaught handler error: requestId=${requestId} message=${message}\n${stack}\n`,
  );
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'DEV_SERVER_ERROR',
      message: 'see server logs',
      details: { requestId },
    }),
    isBase64Encoded: false,
  };
}

export function writeResponse(res: ServerResponse, result: DevResult): void {
  res.statusCode = result.statusCode;
  const headers = result.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    res.setHeader(name, String(value));
  }
  if (!res.getHeader('content-type')) {
    res.setHeader('Content-Type', 'application/json');
  }
  // CORS: attach Access-Control-Allow-Origin to the ACTUAL response too
  // (not only the preflight). The browser blocks the response body from JS
  // if this header is missing — even when preflight succeeded. Mirror the
  // dev policy here; production wires CORS via APIGW v2 corsPreflight.
  if (!res.getHeader('access-control-allow-origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  if (Array.isArray(result.cookies) && result.cookies.length > 0) {
    // Node's `res.setHeader` replaces the existing value; for multiple
    // Set-Cookie entries the value MUST be an array (one entry per cookie,
    // not joined, per RFC 6265). REQ-NDS-4 scenario 3.
    res.setHeader('Set-Cookie', [...result.cookies]);
  }
  const body = result.body ?? '';
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

async function readBody(
  req: IncomingMessage,
  maxBody: number,
): Promise<{ body: string | undefined; tooLarge: boolean }> {
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string' && Number(contentLength) > maxBody) {
    return { body: undefined, tooLarge: true };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBody) {
      // Drain to keep the socket alive.
      for await (const _ of req) void _;
      return { body: undefined, tooLarge: true };
    }
    chunks.push(buf);
  }
  const buf = Buffer.concat(chunks);
  const body = buf.length > 0 ? buf.toString('utf8') : undefined;
  return { body, tooLarge: false };
}

interface RequestContext {
  lambdas: ReadonlyArray<LambdaSpecForDev>;
  maxBody: number;
  allowedMethods: string;
}

function logRequest(line: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
}): void {
  // REQ-NDS NFR-3 — one stdout line per request, human readable.
  process.stdout.write(
    `[dev-server] ${line.method} ${line.path} -> ${line.statusCode} ${line.durationMs}ms requestId=${line.requestId}\n`,
  );
}

function startRequest(context: RequestContext, req: IncomingMessage, res: ServerResponse): void {
  const startedAt = Date.now();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = (req.method ?? 'GET').toUpperCase();
  const fullPath = url.pathname;

  // CORS preflight precedes everything (REQ-NDS-7).
  if (method === 'OPTIONS') {
    for (const [name, value] of Object.entries(corsPreflightHeaders())) {
      res.setHeader(name, value);
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  // Anything outside /api/v1 is dev-server scope, not Lambda scope.
  if (!fullPath.startsWith(API_PREFIX)) {
    const envelope = toErrorEnvelope(
      'ROUTE_NOT_REGISTERED',
      `${method} ${fullPath} is not mounted`,
    );
    writeResponse(res, envelope);
    logRequest({
      method,
      path: fullPath,
      statusCode: envelope.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: 'n/a',
    });
    return;
  }

  const pathAfterPrefix = fullPath.slice(API_PREFIX.length) || '/';
  const rawQueryString = url.searchParams.toString();

  // /api/v1/health short-circuit (REQ-NDS-8).
  if (method === 'GET' && pathAfterPrefix === '/health') {
    const result: DevResult = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
      isBase64Encoded: false,
    };
    writeResponse(res, result);
    logRequest({
      method,
      path: fullPath,
      statusCode: result.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: 'n/a',
    });
    return;
  }

  // Method allowlist (REQ-NDS-9 EC-5).
  if (!ALLOWED_METHOD_LIST.includes(method)) {
    const err: DevResult = {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', Allow: context.allowedMethods },
      body: JSON.stringify({
        code: 'METHOD_NOT_ALLOWED',
        message: `${method} ${pathAfterPrefix} is not allowed`,
      }),
      isBase64Encoded: false,
    };
    writeResponse(res, err);
    logRequest({
      method,
      path: fullPath,
      statusCode: err.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: 'n/a',
    });
    return;
  }

  // Body-size gate (REQ-NDS-9 EC-1) — pre-read check.
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string' && Number(contentLength) > context.maxBody) {
    const envelope = toErrorEnvelope('PAYLOAD_TOO_LARGE', `body exceeds ${context.maxBody} bytes`);
    writeResponse(res, envelope);
    logRequest({
      method,
      path: fullPath,
      statusCode: envelope.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: 'n/a',
    });
    return;
  }

  // Body read + cookie parse + event build happen inside an async chain so
  // the request handler can stay synchronous at the top.
  void (async () => {
    const { body, tooLarge } = await readBody(req, context.maxBody);
    if (tooLarge) {
      const envelope = toErrorEnvelope(
        'PAYLOAD_TOO_LARGE',
        `body exceeds ${context.maxBody} bytes`,
      );
      writeResponse(res, envelope);
      logRequest({
        method,
        path: fullPath,
        statusCode: envelope.statusCode,
        durationMs: Date.now() - startedAt,
        requestId: 'n/a',
      });
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const lambda = matchRoute(context.lambdas, method, fullPath);
    // Use the REGISTERED routeKey (e.g. "GET /api/v1/products/{id}/movements")
    // when the path has placeholder segments, so the BC dispatchers' ROUTES
    // tables (which key on the template, not the substituted path) match.
    // For paths without placeholders, lambda.routeKey === `${method} ${fullPath}`.
    const routeKey = lambda ? lambda.routeKey : `${method} ${fullPath}`;
    const event = toApiGatewayProxyEventV2({
      req,
      method,
      // rawPath must include the `/api/v1` prefix to match real APIGW v2
      // wire format (full path including stage prefix, not pathAfterPrefix).
      // Handlers like get-product.ts use regexes that expect the prefix.
      rawPath: fullPath,
      // routeKey must include `/api/v1` so the BC dispatchers'
      // ROUTES tables (which key on the prefix) can match.
      routeKey,
      rawQueryString,
      ...(body !== undefined ? { body } : {}),
      cookies,
    });
    if (!lambda) {
      const envelope = toErrorEnvelope(
        'ROUTE_NOT_REGISTERED',
        `${method} ${pathAfterPrefix} is not registered`,
      );
      writeResponse(res, envelope);
      logRequest({
        method,
        path: fullPath,
        statusCode: envelope.statusCode,
        durationMs: Date.now() - startedAt,
        requestId: event.requestContext.requestId,
      });
      return;
    }
    const ctx: DevContext = {
      requestId: event.requestContext.requestId,
      functionName: lambda.functionName,
      callbackWaitsForEmptyEventLoop: false,
      getRemainingTimeInMillis: () => 30_000,
    };
    try {
      const result = await Promise.resolve(lambda.handler(event, ctx));
      if (result && (result as { isBase64Encoded?: boolean }).isBase64Encoded === true) {
        const envelope = toErrorEnvelope(
          'UNSUPPORTED_BINARY_RESPONSE',
          'binary responses are out of scope for the dev server',
          { requestId: ctx.requestId },
        );
        writeResponse(res, envelope);
        logRequest({
          method,
          path: fullPath,
          statusCode: envelope.statusCode,
          durationMs: Date.now() - startedAt,
          requestId: ctx.requestId,
        });
        return;
      }
      writeResponse(res, result as DevResult);
      logRequest({
        method,
        path: fullPath,
        statusCode: (result as DevResult).statusCode,
        durationMs: Date.now() - startedAt,
        requestId: ctx.requestId,
      });
      return;
    } catch (err) {
      const errResult = buildDevServerError(ctx.requestId, err);
      writeResponse(res, errResult);
      logRequest({
        method,
        path: fullPath,
        statusCode: errResult.statusCode,
        durationMs: Date.now() - startedAt,
        requestId: ctx.requestId,
      });
    }
  })();
}

// ---------------------------------------------------------------------------
// createDevServer — public factory. REQ-NDS-1, REQ-NDS-2.
// ---------------------------------------------------------------------------

export function createDevServer({
  lambdas,
}: {
  lambdas: ReadonlyArray<LambdaSpecForDev>;
  port?: number;
}): Server {
  if (!Array.isArray(lambdas)) {
    throw new TypeError('createDevServer: `lambdas` must be an array');
  }

  const maxBody = resolveMaxBody(process.env.DEV_SERVER_MAX_BODY_BYTES);
  if (maxBody.clamped) {
    process.stderr.write(
      `[dev-server] WARN: DEV_SERVER_MAX_BODY_BYTES clamped to the 1 MiB floor (${MAX_BODY_FLOOR}).\n`,
    );
  }

  const allowedMethods = ALLOW_METHODS; // base allowlist (REQ-NDS-9 EC-5)

  const server = createServer((req, res) => {
    startRequest({ lambdas, maxBody: maxBody.value, allowedMethods }, req, res);
  });

  return server;
}

// ---------------------------------------------------------------------------
// boot — CLI entry. Flattens LAMBDAS, dynamically imports each handler,
// binds to 127.0.0.1:port, registers graceful shutdown (REQ-NDS-9).
// ---------------------------------------------------------------------------

/**
 * Convert a `LambdaSpec` (CDK shape: routeKey-less) into one
 * `LambdaSpecForDev` per `(method, path)` pair. The handler is loaded
 * dynamically from `entry`; failures bubble up so `boot()` can fail loud.
 */
async function loadLambdas(): Promise<LambdaSpecForDev[]> {
  const flat: LambdaSpecForDev[] = [];
  for (const spec of LAMBDAS) {
    type EntryModule = { handler?: unknown };
    let mod: EntryModule;
    try {
      mod = (await import(spec.entry)) as EntryModule;
    } catch (err) {
      // Defensive: handler files may not exist yet in early dev (the production
      // CDK AppStack uses a 4-level-relative path resolution that resolves
      // correctly under `dist/` but one level short under source `.ts`).
      // We skip + warn so the dev server can still start for cross-BC work,
      // unblocking frontend/SPA work even when backend Lambdas are stub-only.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[dev-server] skipped ${spec.functionName} (${spec.entry}): ${message}\n`,
      );
      continue;
    }
    const handler = mod.handler;
    if (typeof handler !== 'function') {
      process.stderr.write(
        `[dev-server] skipped ${spec.functionName} (${spec.entry}): no exported "handler" function\n`,
      );
      continue;
    }
    for (const route of spec.routes) {
      for (const method of route.methods) {
        flat.push({
          routeKey: `${method} ${route.path}`,
          functionName: spec.functionName,
          // The cast is structural — handlers accept the dev event shape
          // but are typed against `aws-lambda`'s types in their own modules.
          handler: handler as DevHandler,
        });
      }
    }
  }
  return flat;
}

export async function boot(): Promise<Server> {
  const port = resolvePort();
  const lambdas = await loadLambdas();
  const server = createDevServer({ lambdas, port });
  await new Promise<void>((resolveFn) => {
    server.listen(port, bindAddress(), () => resolveFn());
  });
  process.stdout.write(`listening on http://localhost:${port}\n`);
  registerGracefulShutdown(server);
  return server;
}

function registerGracefulShutdown(server: Server): void {
  let draining = false;
  const drainAndExit = (signal: string): void => {
    if (draining) return;
    draining = true;
    process.stdout.write(`[dev-server] received ${signal}, draining...\n`);
    server.close((err) => {
      if (err) {
        process.stderr.write(`[dev-server] close error: ${err.message}\n`);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGINT', () => drainAndExit('SIGINT'));
  process.on('SIGTERM', () => drainAndExit('SIGTERM'));
}

/**
 * Exported for tests (Task 1.11). Mirrors the in-place handler wired by
 * `boot()` so a test can drive the same code path without standing up
 * the full handler-import pipeline.
 */
export function installGracefulShutdown(server: Server): {
  drainAndExit: (signal: string) => void;
} {
  let draining = false;
  const drainAndExit = (signal: string): void => {
    if (draining) return;
    draining = true;
    process.stdout.write(`[dev-server] received ${signal}, draining...\n`);
    server.close((err) => {
      if (err) {
        process.stderr.write(`[dev-server] close error: ${err.message}\n`);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  return { drainAndExit };
}

// Entry — only run when invoked via `tsx scripts/dev-server.ts`.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  void boot().catch((err: unknown) => {
    process.stderr.write(
      `[dev-server] boot failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}

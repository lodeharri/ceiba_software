/**
 * Request context (PR 1, design.md §12.2).
 *
 * Wraps a Lambda handler so each invocation carries:
 *   - a requestId (echoed from the incoming `X-Request-Id` header,
 *     or a fresh UUID v4 if missing);
 *   - a pino child logger bound with the mandatory fields;
 *   - the start timestamp for latencyMs calculation.
 *
 * The handler signature matches API Gateway HTTP API v2 (the
 * `(event, ctx, callback)` form) so wrappers compose with
 * `@types/aws-lambda`'s `APIGatewayProxyHandler`. Handlers may
 * `return` a result or invoke the callback; both paths are
 * supported but the wrapper always awaits the returned promise.
 */

import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
import type { Logger as PinoLogger } from 'pino';
import { createLogger } from './logger.js';

export interface RequestContext {
  requestId: string;
  logger: PinoLogger;
  startedAt: number;
  /** The bounded context (BC) name. Filled in by per-BC bootstrap. */
  bc: string;
}

export interface RequestContextOptions {
  /** Optional BC name to bind to the child logger. */
  bc?: string;
  /** Optional pre-built logger (tests inject fakes). */
  logger?: PinoLogger;
}

/**
 * Wraps an API Gateway HTTP v2 handler so the inner function receives
 * a `RequestContext` instead of the raw Lambda `Context`. The wrapper
 * resolves the X-Request-Id, builds a child logger, and times the
 * invocation.
 */
export function withRequestContext<E extends APIGatewayProxyEventV2 = APIGatewayProxyEventV2>(
  inner: (event: E, ctx: RequestContext) => Promise<APIGatewayProxyResultV2>,
  options: RequestContextOptions = {},
): (
  event: E,
  lambdaCtx: LambdaContext,
  callback: (...args: unknown[]) => void,
) => Promise<APIGatewayProxyResultV2> {
  return async (event, lambdaCtx, _callback) => {
    void lambdaCtx;
    const incoming = event.headers?.['x-request-id'] ?? event.headers?.['X-Request-Id'];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

    const base = options.logger ?? createLogger();
    const child = base.child({
      requestId,
      awsRequestId: lambdaCtx.awsRequestId,
      route: event.routeKey,
      ...(options.bc !== undefined ? { bc: options.bc } : {}),
    });

    const ctx: RequestContext = {
      requestId,
      logger: child,
      startedAt: Date.now(),
      bc: options.bc ?? 'unknown',
    };

    return inner(event, ctx);
  };
}

/**
 * Computes the elapsed milliseconds since `ctx.startedAt`.
 */
export function elapsedMs(ctx: RequestContext): number {
  return Date.now() - ctx.startedAt;
}

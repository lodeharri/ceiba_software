/**
 * Inventory dispatcher (PR 2b).
 *
 * Routes inventory Lambda invocations to per-route handlers based on
 * the API Gateway routeKey. Follows the same pattern as
 * `shared/dispatchers/products-categories-dispatcher.ts`.
 *
 * Pipeline:
 *   1. Match event.routeKey against the route table.
 *   2. Dispatch to the matching per-route handler.
 *   3. Return 404 for unknown routes.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';

import { verifyJwt } from '../jwt-middleware.js';
import { UnauthorizedError } from '../errors/typed-errors.js';
import { ErrorCode } from '@mercadoexpress/shared';

import { handler as recordMovement } from '../../inventory/interface/handlers/record-movement.js';
import { handler as listMovements } from '../../inventory/interface/handlers/list-movements.js';

const ROUTES = {
  'POST /api/v1/products/{id}/movements': recordMovement,
  'GET /api/v1/products/{id}/movements': listMovements,
} as const;

type PerRouteHandler = (
  event: APIGatewayProxyEventV2,
  ctx: LambdaContext,
  callback: (...args: unknown[]) => void,
) => Promise<APIGatewayProxyResultV2>;

function extractBearer(event: APIGatewayProxyEventV2): string {
  const h = event.headers;
  const raw = (h?.['authorization'] ?? h?.['Authorization']) as string | undefined;
  if (!raw || !raw.startsWith('Bearer ')) {
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing Bearer token');
  }
  return raw.slice('Bearer '.length).trim();
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  lambdaCtx: LambdaContext,
  callback: (...args: unknown[]) => void,
): Promise<APIGatewayProxyResultV2> => {
  const token = extractBearer(event);
  await verifyJwt(token);
  const key = event.routeKey ?? '';
  const route = (ROUTES as Record<string, PerRouteHandler | undefined>)[key];
  if (!route) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOT_FOUND', message: `No route matches ${key}.` }),
    };
  }
  return route(event, lambdaCtx, callback);
};

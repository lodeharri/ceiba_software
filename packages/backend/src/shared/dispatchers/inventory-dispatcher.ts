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

export const handler = async (
  event: APIGatewayProxyEventV2,
  lambdaCtx: LambdaContext,
  callback: (...args: unknown[]) => void,
): Promise<APIGatewayProxyResultV2> => {
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

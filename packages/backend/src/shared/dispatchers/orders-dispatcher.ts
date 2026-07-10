/**
 * Orders Lambda dispatcher (PR 2c).
 *
 * Routes orders Lambda invocations to per-route handlers based on the
 * API Gateway routeKey. Follows the same pattern as
 * `shared/dispatchers/inventory-dispatcher.ts`.
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

import { handler as createOrder } from '../../orders/interface/handlers/create-order.js';
import { handler as listOrders } from '../../orders/interface/handlers/list-orders.js';
import { handler as getOrder } from '../../orders/interface/handlers/get-order.js';
import { handler as approveOrder } from '../../orders/interface/handlers/approve-order.js';
import { handler as rejectOrder } from '../../orders/interface/handlers/reject-order.js';
import { handler as receiveOrder } from '../../orders/interface/handlers/receive-order.js';

const ROUTES = {
  'POST /api/v1/orders': createOrder,
  'GET /api/v1/orders': listOrders,
  'GET /api/v1/orders/{id}': getOrder,
  'POST /api/v1/orders/{id}/approve': approveOrder,
  'POST /api/v1/orders/{id}/reject': rejectOrder,
  'POST /api/v1/orders/{id}/receive': receiveOrder,
} as const;

type PerRouteHandler = (
  event: APIGatewayProxyEventV2,
  ctx: LambdaContext,
) => Promise<APIGatewayProxyResultV2>;

export const handler = async (
  event: APIGatewayProxyEventV2,
  lambdaCtx: LambdaContext,
): Promise<APIGatewayProxyResultV2> => {
  const key = event.routeKey ?? '';
  // Cast through unknown: the handlers accept (event, ctx) from withRequestContext
  // but the PerRouteHandler signature requires (event, ctx, callback) for
  // compatibility with the Lambda v2 callback API. Same pattern as inventory-dispatcher.ts.
  const route = (ROUTES as unknown as Record<string, PerRouteHandler | undefined>)[key];
  if (!route) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOT_FOUND', message: `No route matches ${key}.` }),
    };
  }
  return route(event, lambdaCtx);
};

/**
 * Alerts dispatcher (PR 2b).
 *
 * Routes alerts Lambda invocations to per-route handlers based on
 * the API Gateway routeKey. Follows the same pattern as
 * `shared/dispatchers/products-categories-dispatcher.ts`.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';

import { handler as listAlerts } from '../../alerts/interface/handlers/list-alerts.js';
import { handler as getAlert } from '../../alerts/interface/handlers/get-alert.js';

const ROUTES = {
  'GET /api/v1/alerts': listAlerts,
  'GET /api/v1/alerts/{id}': getAlert,
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

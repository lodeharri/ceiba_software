/**
 * Consolidated Lambda entry point — MercadoExpress API (PR 2).
 *
 * Single Lambda that dispatches ALL HTTP requests to the appropriate
 * bounded-context handler based on `event.routeKey`. Replaces the
 * previous 5-Lambda setup (one per BC: auth, products, inventory,
 * alerts, orders).
 *
 * Mirrors the router pattern from scripts/dev-server.ts so local dev
 * and AWS Lambda share the same route map.
 *
 * Pipeline:
 *   1. Short-circuit `/api/v1/health` inline (200, no Lambda call).
 *   2. Dispatch by `event.routeKey` to the matching BC handler.
 *   3. Return 404 for unknown routes.
 *
 * All non-auth routes are protected by JWT inside the individual
 * handlers — this entry point does NOT re-verify the token.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';

// ── Per-route handlers (imported directly — no indirection via dispatchers) ─────

// Auth
import { handler as authLogin } from '../auth/interface/handlers/login.js';

// Products + Categories
import { handler as createProduct } from '../products/interface/handlers/create-product.js';
import { handler as listProducts } from '../products/interface/handlers/list-products.js';
import { handler as getProduct } from '../products/interface/handlers/get-product.js';
import { handler as updateProduct } from '../products/interface/handlers/update-product.js';
import { handler as listCategories } from '../categories/interface/handlers/list-categories.js';
import { handler as createCategory } from '../categories/interface/handlers/create-category.js';

// Inventory
import { handler as recordMovement } from '../inventory/interface/handlers/record-movement.js';
import { handler as listMovements } from '../inventory/interface/handlers/list-movements.js';

// Alerts
import { handler as listAlerts } from '../alerts/interface/handlers/list-alerts.js';
import { handler as getAlert } from '../alerts/interface/handlers/get-alert.js';

// Orders
import { handler as createOrder } from '../orders/interface/handlers/create-order.js';
import { handler as listOrders } from '../orders/interface/handlers/list-orders.js';
import { handler as getOrder } from '../orders/interface/handlers/get-order.js';
import { handler as approveOrder } from '../orders/interface/handlers/approve-order.js';
import { handler as rejectOrder } from '../orders/interface/handlers/reject-order.js';
import { handler as receiveOrder } from '../orders/interface/handlers/receive-order.js';

// ── Route map ─────────────────────────────────────────────────────────────────

type SubHandler = (
  event: APIGatewayProxyEventV2,
  ctx: LambdaContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb?: any,
) => Promise<APIGatewayProxyResultV2>;

/** RouteKey → handler. RouteKey format: "METHOD /path". */
const ROUTE_MAP: Record<string, SubHandler> = {
  // Auth — no JWT (issues the token)
  'POST /api/v1/auth/login': authLogin as SubHandler,

  // Products + Categories
  'POST /api/v1/products': createProduct as SubHandler,
  'GET /api/v1/products': listProducts as SubHandler,
  'GET /api/v1/products/{id}': getProduct as SubHandler,
  'PATCH /api/v1/products/{id}': updateProduct as SubHandler,
  'GET /api/v1/categories': listCategories as SubHandler,
  'POST /api/v1/categories': createCategory as SubHandler,

  // Inventory — JWT verification is inside each handler
  'POST /api/v1/products/{id}/movements': recordMovement as SubHandler,
  'GET /api/v1/products/{id}/movements': listMovements as SubHandler,

  // Alerts
  'GET /api/v1/alerts': listAlerts as SubHandler,
  'GET /api/v1/alerts/{id}': getAlert as SubHandler,

  // Orders
  'POST /api/v1/orders': createOrder as SubHandler,
  'GET /api/v1/orders': listOrders as SubHandler,
  'GET /api/v1/orders/{id}': getOrder as SubHandler,
  'POST /api/v1/orders/{id}/approve': approveOrder as SubHandler,
  'POST /api/v1/orders/{id}/reject': rejectOrder as SubHandler,
  'POST /api/v1/orders/{id}/receive': receiveOrder as SubHandler,
};

// ── Health short-circuit ──────────────────────────────────────────────────────

const HEALTH_ROUTE = 'GET /api/v1/health';

function healthResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  };
}

// ── Lambda entry ─────────────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEventV2,
  ctx: LambdaContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb?: any,
): Promise<APIGatewayProxyResultV2> => {
  // event.routeKey is the authoritative wire format from API GW HTTP API v2.
  // Fall back to METHOD + rawPath for the dev-server event shape.
  const routeKey =
    (event as { routeKey?: string }).routeKey ??
    `${event.requestContext.http.method} ${event.rawPath}`;

  // Health short-circuit (REQ-NDS-8)
  if (routeKey === HEALTH_ROUTE) {
    return healthResponse();
  }

  const sub = ROUTE_MAP[routeKey];
  if (!sub) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOT_FOUND', message: `Route ${routeKey} is not wired.` }),
    };
  }

  return sub(event, ctx, cb);
};

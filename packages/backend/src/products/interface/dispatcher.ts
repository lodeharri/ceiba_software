/**
 * Products-Lambda dispatcher entry (PR 2a).
 *
 * API Gateway HTTP API v2 sends all routes that target
 * `MercadoExpress-{stage}-products-lambda` to this single `handler`.
 * We pick the per-route sub-handler from `event.routeKey`.
 *
 * PR 2a scope: this dispatcher covers the 4 product routes + 2
 * category routes (categories BC merged into products Lambda per
 * `design.md §2.1`). Inventory/alerts/orders remain on their own
 * placeholders until PR 2b/2c.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { handler as createProduct } from './handlers/create-product.js';
import { handler as listProducts } from './handlers/list-products.js';
import { handler as getProduct } from './handlers/get-product.js';
import { handler as updateProduct } from './handlers/update-product.js';
import { handler as listCategories } from '../../categories/interface/handlers/list-categories.js';
import { handler as createCategory } from '../../categories/interface/handlers/create-category.js';

type AsyncHandler = (
  event: APIGatewayProxyEventV2,
  ctx: Context,
) => Promise<APIGatewayProxyResultV2>;

const TABLE: Record<string, AsyncHandler> = {
  'POST /api/v1/products': createProduct as AsyncHandler,
  'GET /api/v1/products': listProducts as AsyncHandler,
  'GET /api/v1/products/{id}': getProduct as AsyncHandler,
  'PATCH /api/v1/products/{id}': updateProduct as AsyncHandler,
  'GET /api/v1/categories': listCategories as AsyncHandler,
  'POST /api/v1/categories': createCategory as AsyncHandler,
};

export const handler = async (
  event: APIGatewayProxyEventV2,
  ctx: Context,
): Promise<APIGatewayProxyResultV2> => {
  const route = event.routeKey ?? `${event.requestContext.http.method} ${event.rawPath}`;
  const sub = TABLE[route];
  if (!sub) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOT_FOUND', message: `Route ${route} is not wired.` }),
    };
  }
  return sub(event, ctx);
};

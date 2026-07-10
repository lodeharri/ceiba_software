/**
 * Shared dispatcher (PR 2a, design.md §2.1 — "categories-lambda (within products-lambda)").
 *
 * The products Lambda serves 4 product routes + 2 category routes from a
 * single NodejsFunction. The single entry file
 * `packages/backend/src/products/interface/handlers/bootstrap.ts` re-exports
 * the `handler` exported by this module.
 *
 * Why a shared dispatcher lives OUTSIDE both BCs:
 *   - The cross-BC architectural test (`test/architecture/cross-bc-bounds.test.ts`)
 *     forbids any path under one BC's `src/` from importing another BC's
 *     `src/`. Placing the cross-BC wiring here, in `packages/backend/src/shared/`,
 *     keeps each BC pure.
 *   - Per design.md §2.1, "No Lambda authorizer": JWT verification happens
 *     INSIDE the Lambda, NOT as an API Gateway authorizer. This dispatcher
 *     verifies the JWT once, then routes by `routeKey` to the per-route
 *     handler.
 *
 * Pipeline per invocation:
 *   1. Extract Bearer token from the Authorization header.
 *   2. `verifyJwt(token)` — throws UnauthorizedError on failure (each
 *      per-route handler's own `toErrorResponse` translates this to a
 *      401 envelope; the dispatcher does NOT do its own error mapping,
 *      it lets the per-route handler own the envelope shape).
 *   3. switch on `event.routeKey` → dispatch to the matching per-route
 *      handler. Each per-route handler runs its own `withRequestContext`
 *      and its own `toErrorResponse` wrapping — the dispatcher is a
 *      pure router.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
import { verifyJwt } from '../jwt-middleware.js';
import { UnauthorizedError } from '../errors/typed-errors.js';
import { ErrorCode } from '@mercadoexpress/shared';

// Re-exports of per-route handlers. Both paths stay inside their own BC
// (no cross-BC import): we are the orchestrator outside both BCs.
import { handler as createProduct } from '../../products/interface/handlers/create-product.js';
import { handler as listProducts } from '../../products/interface/handlers/list-products.js';
import { handler as getProduct } from '../../products/interface/handlers/get-product.js';
import { handler as updateProduct } from '../../products/interface/handlers/update-product.js';
import { handler as listCategories } from '../../categories/interface/handlers/list-categories.js';
import { handler as createCategory } from '../../categories/interface/handlers/create-category.js';

const ROUTES = {
  'POST /api/v1/products': createProduct,
  'GET /api/v1/products': listProducts,
  'GET /api/v1/products/{id}': getProduct,
  'PATCH /api/v1/products/{id}': updateProduct,
  'GET /api/v1/categories': listCategories,
  'POST /api/v1/categories': createCategory,
} as const satisfies Record<string, PerRouteHandler>;

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

/**
 * Lambda handler for the products-lambda.
 *
 * Verification + routing only. Each per-route handler runs its own
 * `withRequestContext` + `toErrorResponse` so the JWT error is mapped
 * consistently with the per-route handlers' error envelopes.
 */
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

// Exposed for tests so they can assert the routing table without spinning
// up the Lambda runtime. Not part of the production runtime path.
export const _testRoutes = Object.keys(ROUTES) as readonly (keyof typeof ROUTES)[];

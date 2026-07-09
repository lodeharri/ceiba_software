/**
 * Placeholder entry for the PR 1 Lambda wiring. The real per-BC entry
 * (one file per Lambda: `auth.ts`, `products.ts`, etc.) ships in PR 2a+.
 *
 * Every PR 1 Lambda returns a 503 NOT_IMPLEMENTED envelope so the
 * construct tests can assert the wiring (5 Lambdas, 5 log groups,
 * reserved concurrency per stage) without standing up real handlers.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  void event;
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'NOT_IMPLEMENTED',
      message:
        'This endpoint lands in PR 2a (auth/products) or PR 2b (inventory/alerts) or PR 2c (orders).',
      details: { route: event.routeKey },
    }),
  };
};

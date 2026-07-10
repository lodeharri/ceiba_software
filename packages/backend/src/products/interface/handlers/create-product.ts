/**
 * Products Lambda placeholder — POST /products (PR 1).
 *
 * Real create-product use case (Zod validation, SKU uniqueness check,
 * category FK lookup) ships in PR 2a.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: 'POST /products lands in PR 2a',
      details: { route: event.routeKey ?? 'POST /products' },
    }),
  };
};

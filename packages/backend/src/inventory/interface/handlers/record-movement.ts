/**
 * Inventory Lambda placeholder — POST /products/{id}/movements (PR 1).
 *
 * Real record-movement use case (atomic stock update, STOCK_WOULD_GO_NEGATIVE
 * guard, audit trail) ships in PR 2b.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: 'POST /products/{id}/movements lands in PR 2b',
      details: { route: event.routeKey ?? 'POST /products/{id}/movements' },
    }),
  };
};

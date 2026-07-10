/**
 * Orders Lambda placeholder — POST /orders/{id}/receive (PR 1).
 *
 * Real receive-order use case (state transition validation,
 * ORDER_INVALID_TRANSITION guard) ships in PR 2c.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: 'POST /orders/{id}/receive lands in PR 2c',
      details: { route: event.routeKey ?? 'POST /orders/{id}/receive' },
    }),
  };
};

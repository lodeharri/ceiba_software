/**
 * Alerts Lambda placeholder — GET /alerts (PR 1).
 *
 * Real list-alerts use case (filter by BC, role-based scoping) ships in PR 2b.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: 'GET /alerts lands in PR 2b',
      details: { route: event.routeKey ?? 'GET /alerts' },
    }),
  };
};

/**
 * GET /healthz stub (PR 1).
 *
 * Returns `{ status: 'ok' }` with a 200. Real readiness/liveness
 * probes (DB ping, etc.) ship in PR 2a alongside the prisma client.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export const healthHandler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  void _event;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  };
};

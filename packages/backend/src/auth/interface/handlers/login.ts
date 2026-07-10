/**
 * Auth Lambda placeholder — POST /auth/login (PR 1).
 *
 * The real handler (bcrypt password verification, JWT issuance,
 * rate-limiting per US-1) ships in PR 2a per openspec/changes/
 * add-inventory-mvp/tasks.md. PR 1 returns 501 NOT_IMPLEMENTED so
 * the route wiring can be exercised end-to-end.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: 'POST /auth/login lands in PR 2a',
      details: { route: event.routeKey ?? 'POST /auth/login' },
    }),
  };
};

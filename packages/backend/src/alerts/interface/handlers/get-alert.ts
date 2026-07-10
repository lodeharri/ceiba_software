/**
 * Alerts BC — `GET /alerts/{id}` Lambda handler (PR 2b).
 *
 * Extracts id from path params, calls GetAlert use case, returns
 * the alert with product snapshot.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { getAlertsBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

function extractAlertId(rawPath: string): string | undefined {
  const m = /\/api\/v1\/alerts\/([0-9a-f-]{36})$/.exec(rawPath);
  return m?.[1];
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const id = extractAlertId(event.rawPath);
      if (!id) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Missing or malformed id.',
            requestId: ctx.requestId,
          }),
        };
      }

      const useCase = getAlertsBootstrap().getAlert;
      const result = await useCase.execute({ id });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({
          alert: {
            id: result.alert.id,
            productId: result.alert.productId,
            status: result.alert.status,
            type: result.alert.type,
            resolvedAt: result.alert.resolvedAt?.toISOString() ?? null,
            createdAt: result.alert.createdAt.toISOString(),
          },
          product: result.product,
        }),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'alerts' },
);

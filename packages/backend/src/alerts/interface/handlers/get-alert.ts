/**
 * Alerts BC — `GET /alerts/{id}` Lambda handler.
 *
 * Extracts id from path params, calls GetAlert use case, returns the
 * flat `Alert` read model composed via `composeAlert(alert, product)`
 * (see `application/compose-alert.ts`). The contract is the flat
 * `Alert` schema in `packages/shared`, NOT a `{ alert, product }`
 * wrapper.
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
        body: JSON.stringify(result),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'alerts' },
);

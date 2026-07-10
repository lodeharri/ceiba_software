/**
 * Orders BC — `POST /api/v1/orders/{id}/reject` handler (PR 2c).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getOrdersBootstrap } from './bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { extractOrderId } from './path-utils.js';
import { rejectOrderRequestSchema } from '../schemas/reject-order-request.js';

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const orderId = extractOrderId(event.rawPath);
      if (!orderId) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: 'VALIDATION_ERROR',
            message: 'Missing or malformed order ID in path.',
            requestId: ctx.requestId,
          }),
        };
      }

      let body: unknown;
      try {
        body = JSON.parse(event.body ?? '{}');
      } catch {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: 'VALIDATION_ERROR',
            message: 'Invalid JSON body.',
            requestId: ctx.requestId,
          }),
        };
      }

      const parsed = rejectOrderRequestSchema.safeParse(body);
      if (!parsed.success) {
        return {
          statusCode: 422,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: 'REJECTION_REASON_TOO_SHORT',
            message:
              parsed.error.errors[0]?.message ?? 'El motivo debe tener al menos 10 caracteres.',
            details: parsed.error.errors,
            requestId: ctx.requestId,
          }),
        };
      }

      const bootstrap = getOrdersBootstrap();
      const result = await bootstrap.rejectOrderUseCase.execute({
        orderId,
        reason: parsed.data.reason,
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({ ...result, requestId: ctx.requestId }),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'orders' },
);

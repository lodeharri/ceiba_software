/**
 * Orders BC — `GET /api/v1/orders` handler (PR 2c).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getOrdersBootstrap } from './bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

function parseQuery(event: APIGatewayProxyEventV2) {
  const q = event.queryStringParameters ?? {};
  return {
    productId: q['productId'] ?? undefined,
    status: q['status'] ?? undefined,
    page: Math.max(1, parseInt(q['page'] ?? '1', 10)),
    size: Math.max(1, Math.min(100, parseInt(q['size'] ?? '20', 10))),
  };
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const { productId, status, page, size } = parseQuery(event);

      // Validate status if provided
      const validStatuses = ['PENDIENTE', 'APROBADA', 'RECHAZADA', 'RECIBIDA'];
      if (status !== undefined && !validStatuses.includes(status)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: 'VALIDATION_ERROR',
            message: `Invalid status. Must be one of: ${validStatuses.join(', ')}.`,
            requestId: ctx.requestId,
          }),
        };
      }

      const bootstrap = getOrdersBootstrap();
      const result = await bootstrap.listOrdersUseCase.execute({
        page,
        size,
        ...(productId !== undefined ? { productId } : {}),
        ...(status !== undefined
          ? { status: status as 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'RECIBIDA' }
          : {}),
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

/**
 * Products BC — `GET /api/v1/products/{id}` Lambda handler (PR 2a).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getProductsBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

function extractId(rawPath: string): string | undefined {
  const m = /\/api\/v1\/products\/([0-9a-f-]{36})$/.exec(rawPath);
  return m?.[1];
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const id = extractId(event.rawPath);
      if (!id) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: 'VALIDATION_ERROR',
            message: 'Missing or malformed id.',
            requestId: ctx.requestId,
          }),
        };
      }
      const useCase = getProductsBootstrap().getProduct;
      const product = await useCase.execute(id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify(product.toReadModel()),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'products' },
);

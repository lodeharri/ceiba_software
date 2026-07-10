/**
 * Categories BC — `GET /api/v1/categories` Lambda handler (PR 2a).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getCategoriesBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

export const handler = withRequestContext(
  async (_event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const useCase = getCategoriesBootstrap().listCategories;
      const list = await useCase.execute();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({
          items: list.map((c) => c.toReadModel()),
          page: 1,
          size: list.length,
          total: list.length,
          hasMore: false,
        }),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'categories' },
);

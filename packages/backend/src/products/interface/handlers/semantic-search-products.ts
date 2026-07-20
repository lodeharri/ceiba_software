/**
 * Products BC — `POST /api/v1/products/semantic-search` Lambda handler (Group 11).
 *
 * Pipeline:
 *   1. JWT authentication (same pattern as other products handlers).
 *   2. Zod-validate the body: { q: string (3-1024 chars), limit?: number (1-50, default 10) }.
 *   3. Execute SemanticSearchUseCase with embedder + product repo.
 *   4. Map errors: InvalidSemanticSearchQueryError → 400, EmbeddingProviderUnavailableError → 503,
 *      everything else → toErrorResponse.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { ErrorCode } from '@mercadoexpress/shared';
import { verifyJwt } from '../../../shared/jwt-middleware.js';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getProductsBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

const SemanticSearchSchema = z.object({
  q: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(1024, 'Query must be at most 1024 characters'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(50, 'Limit must be at most 50')
    .default(10),
});

function extractBearer(event: APIGatewayProxyEventV2): string {
  const raw = (event.headers?.['authorization'] ?? event.headers?.['Authorization']) as
    string | undefined;
  if (!raw || !raw.startsWith('Bearer ')) {
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing Bearer token');
  }
  return raw.slice('Bearer '.length).trim();
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const token = extractBearer(event);
      await verifyJwt(token);

      const rawBody = event.body ?? '{}';
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid JSON body' }),
        };
      }

      const parsed = SemanticSearchSchema.safeParse(parsedBody);
      if (!parsed.success) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: ErrorCode.INVALID_SEMANTIC_SEARCH_QUERY,
            message: 'Invalid query',
            details: parsed.error.flatten(),
          }),
        };
      }

      const { q, limit } = parsed.data;

      const bootstrap = await getProductsBootstrap();
      const result = await bootstrap.semanticSearch.execute({ query: q, limit });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({
          items: result.items.map((p) => p.toReadModel()),
          total: result.total,
        }),
      };
    } catch (thrown) {
      return toErrorResponse(thrown, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'products' },
);

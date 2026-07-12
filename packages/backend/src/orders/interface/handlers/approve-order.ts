/**
 * Orders BC — `POST /api/v1/orders/{id}/approve` handler (PR 2c).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getOrdersBootstrap } from './bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { extractOrderId } from './path-utils.js';

function getUserId(event: APIGatewayProxyEventV2): string {
  const raw = (event.headers?.['authorization'] ?? event.headers?.['Authorization']) as
    string | undefined;
  if (!raw) throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing authorization token.');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing authorization token.');
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    if (typeof payload.sub === 'string' && payload.sub.length > 0) return payload.sub;
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Token missing subject claim.');
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Invalid authorization token.');
  }
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      getUserId(event); // Verify auth before any operation
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

      const bootstrap = getOrdersBootstrap();
      const result = await bootstrap.approveOrderUseCase.execute(orderId);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify(result),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'orders' },
);

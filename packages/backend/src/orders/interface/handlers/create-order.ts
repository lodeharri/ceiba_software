/**
 * Orders BC — `POST /api/v1/orders` handler (PR 2c).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { verifyJwt } from '../../../shared/jwt-middleware.js';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getOrdersBootstrap } from './bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { createOrderRequestSchema } from '../schemas/create-order-request.js';

class ValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

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
    if (typeof payload.sub === 'string' && payload.sub.length > 0) return payload.sub as string;
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Token missing subject claim.');
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Invalid authorization token.');
  }
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      // Verify JWT before any operation
      const rawAuth = (event.headers?.['authorization'] ?? event.headers?.['Authorization']) as
        string | undefined;
      if (!rawAuth || !rawAuth.startsWith('Bearer ')) {
        throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing Bearer token');
      }
      await verifyJwt(rawAuth.slice('Bearer '.length).trim());

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

      const parsed = createOrderRequestSchema.safeParse(body);
      if (!parsed.success) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors[0]?.message ?? 'Validation failed.',
            details: parsed.error.errors,
            requestId: ctx.requestId,
          }),
        };
      }

      const userId = getUserId(event);
      const bootstrap = getOrdersBootstrap();
      const result = await bootstrap.createOrderUseCase.execute({
        productId: parsed.data.productId,
        quantity: parsed.data.quantity,
        ...(parsed.data.fromAlertId !== undefined ? { fromAlertId: parsed.data.fromAlertId } : {}),
        createdBy: userId,
      });

      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify(result),
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        return {
          statusCode: err.httpStatus,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
          body: JSON.stringify({
            code: err.code,
            message: err.message,
            details: err.details,
            requestId: ctx.requestId,
          }),
        };
      }
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'orders' },
);

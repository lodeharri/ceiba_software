/**
 * Orders BC — `POST /api/v1/orders/{id}/receive` handler (PR 2c).
 *
 * DUPLICATE-RECEIVE PROTECTION (RISK-W07):
 * Duplicate POST /receive is blocked by the state machine, NOT by Idempotency-Key.
 * The ReceiveOrderUseCase validates the state machine pre-condition:
 *   - If order.status === 'APROBADA'  → proceeds with four-step atomic flow
 *   - If order.status === 'RECIBIDA'  → throws OrderInvalidTransitionError (409)
 *   - If order.status === 'PENDIENTE' → throws OrderInvalidTransitionError (409)
 *   - If order.status === 'RECHAZADA' → throws OrderInvalidTransitionError (409)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { verifyJwt } from '../../../shared/jwt-middleware.js';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getOrdersBootstrap } from './bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { extractOrderId } from './path-utils.js';

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

      // reason is required for the ENTRADA stock movement
      let reason = 'Recibido por orden de compra';
      if (event.body) {
        try {
          const parsed = JSON.parse(event.body);
          if (
            parsed &&
            typeof parsed === 'object' &&
            'reason' in parsed &&
            typeof parsed.reason === 'string'
          ) {
            reason = parsed.reason;
          }
        } catch {
          // ignore — body is optional
        }
      }

      const userId = (() => {
        const raw = (event.headers?.['authorization'] ?? event.headers?.['Authorization']) as
          string | undefined;
        if (!raw)
          throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing authorization token.');
        const tok = raw.replace(/^Bearer\s+/i, '').trim();
        if (!tok)
          throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing authorization token.');
        try {
          const payload = JSON.parse(
            Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString('utf8'),
          );
          if (typeof payload.sub === 'string' && payload.sub.length > 0)
            return payload.sub as string;
          throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Token missing subject claim.');
        } catch (e) {
          if (e instanceof UnauthorizedError) throw e;
          throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Invalid authorization token.');
        }
      })();

      const bootstrap = getOrdersBootstrap();
      const result = await bootstrap.receiveOrderUseCase.execute(orderId, reason, userId);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({
          ...result.order,
          stockAfter: result.stockAfter,
          closedAlertId: result.closedAlertId,
        }),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'orders' },
);

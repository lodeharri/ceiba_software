/**
 * Inventory BC — `POST /products/{id}/movements` handler (PR 2b).
 *
 * Pipeline:
 *   1. Extract `productId` from rawPath.
 *   2. Parse + validate the JSON body (type, quantity, reason).
 *   3. Decode userId from JWT if present (dispatcher verifies upstream).
 *   4. Invoke `StockMutationService.record(input)` inside the bootstrap.
 *   5. Return `{ movementId, stockAfter }` with 201 on success.
 *   6. Map domain errors via `toErrorResponse`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { getInventoryBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { extractProductId } from './path-utils.js';

// ── Locally-scoped validation error (400, per existing handler pattern) ──

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

class UnauthorizedError extends BaseDomainError {
  constructor(message: string) {
    super({ code: ErrorCode.UNAUTHORIZED, httpStatus: 401, message });
  }
}

// ── Body schema ──

interface RecordMovementBody {
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  reason: string;
}

function parseBody(raw: string | undefined): RecordMovementBody {
  if (!raw) {
    throw new ValidationError('Request body is required.', {});
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationError('Body must be valid JSON.', {});
  }
  if (!obj || typeof obj !== 'object') {
    throw new ValidationError('Body must be a JSON object.', {});
  }

  const r = obj as Record<string, unknown>;
  const type = String(r['type'] ?? '');
  if (type !== 'ENTRADA' && type !== 'SALIDA') {
    throw new ValidationError('type must be ENTRADA or SALIDA.', { type });
  }
  const quantity = Number(r['quantity']);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a positive integer.', { quantity });
  }
  const reason = String(r['reason'] ?? '');
  if (!reason || reason.length < 1 || reason.length > 280) {
    throw new ValidationError('reason must be 1-280 characters.', { reasonLength: reason.length });
  }
  return { type, quantity, reason };
}

// ── User ID extraction ──

/**
 * Extracts the `sub` claim from a Bearer JWT. Throws 401 Unauthorized
 * if no token is present or the claim is missing.
 */
function getUserId(event: APIGatewayProxyEventV2): string {
  const raw = (event.headers?.['authorization'] ?? event.headers?.['Authorization']) as
    string | undefined;
  if (!raw) throw new UnauthorizedError('Missing authorization token.');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new UnauthorizedError('Missing authorization token.');
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    if (typeof payload.sub === 'string' && payload.sub.length > 0) return payload.sub;
    throw new UnauthorizedError('Token missing subject claim.');
  } catch (e) {
    if (e instanceof BaseDomainError) throw e;
    throw new UnauthorizedError('Invalid authorization token.');
  }
}

// ── Handler ──

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const productId = extractProductId(event.rawPath);
      if (!productId) {
        throw new ValidationError('Missing or malformed product ID in path.', {
          rawPath: event.rawPath,
        });
      }

      const body = parseBody(event.body);
      const userId = getUserId(event);

      const svc = getInventoryBootstrap().stockMutationService;
      const result = await svc.record({
        productId,
        type: body.type,
        quantity: body.quantity,
        reason: body.reason,
        userId,
      });

      return {
        statusCode: 201,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': ctx.requestId,
        },
        body: JSON.stringify(result),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'inventory' },
);

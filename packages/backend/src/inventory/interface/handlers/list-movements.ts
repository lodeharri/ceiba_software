/**
 * Inventory BC — `GET /products/{id}/movements` handler (PR 2b).
 *
 * Pipeline:
 *   1. Verify JWT.
 *   2. Parse query parameters (`page`, `size`) with sensible defaults.
 *   3. Validate bounds.
 *   4. Extract `productId` from rawPath.
 *   5. Invoke `StockMovementRepository.listByProduct(args)` inside the bootstrap.
 *   6. Return the page envelope with 200.
 *   7. Map errors via `toErrorResponse`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ErrorCode } from '@mercadoexpress/shared';
import { verifyJwt } from '../../../shared/jwt-middleware.js';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getInventoryBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { extractProductId } from './path-utils.js';

// ── Locally-scoped validation error (400) ──

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

// ── JWT helpers ──

function extractBearer(event: APIGatewayProxyEventV2): string {
  const raw = (event.headers?.['authorization'] ?? event.headers?.['Authorization']) as
    string | undefined;
  if (!raw || !raw.startsWith('Bearer ')) {
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing Bearer token');
  }
  return raw.slice('Bearer '.length).trim();
}

// ── Query param helpers ──

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 50;
const MAX_SIZE = 200;

interface PageParams {
  page: number;
  size: number;
}

function parsePageParams(rawQuery: string): PageParams {
  const params = new URLSearchParams(rawQuery);

  const rawPage = params.get('page');
  const rawSize = params.get('size');

  const page = rawPage !== null ? Number(rawPage) : DEFAULT_PAGE;
  const size = rawSize !== null ? Number(rawSize) : DEFAULT_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError('page must be a positive integer >= 1.', { page });
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
    throw new ValidationError(`size must be an integer between 1 and ${MAX_SIZE}.`, {
      size,
      max: MAX_SIZE,
    });
  }

  return { page, size };
}

// ── Handler ──

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      // Verify JWT
      const token = extractBearer(event);
      await verifyJwt(token);

      const productId = extractProductId(event.rawPath);
      if (!productId) {
        throw new ValidationError('Missing or malformed product ID in path.', {
          rawPath: event.rawPath,
        });
      }

      const { page, size } = parsePageParams(event.rawQueryString);

      const repo = getInventoryBootstrap().stockMovementRepository;
      const result = await repo.listByProduct({ productId, page, size });

      return {
        statusCode: 200,
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

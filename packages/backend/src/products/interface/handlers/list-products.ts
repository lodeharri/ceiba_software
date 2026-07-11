/**
 * Products BC — `GET /api/v1/products` Lambda handler (PR 2a).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { ErrorCode } from '@mercadoexpress/shared';
import { getProductsBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

/**
 * Parse an optional non-negative integer query value.
 *
 * Returns `true` when the parsed integer was assigned to `out[key]`,
 * `false` when the value was skipped (empty / "undefined" / whitespace /
 * non-numeric) — the caller MUST still surface validation errors via `issues`.
 *
 * Rejects `Number(' ')` = 0 (whitespace-only inputs) because accepting it as
 * `minStock=0` would silently match every product via `where.stock.gte=0`.
 */
function parseOptionalNonNegativeInt(
  raw: string,
  key: string,
  issues: Array<{ path: string; message: string }>,
  out: Record<string, unknown>,
): void {
  if (raw === '' || raw === 'undefined' || raw.trim() === '') {
    return; // intentionally omitted
  }
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0) {
    issues.push({ path: key, message: `${key} must be integer >= 0` });
    return;
  }
  out[key] = v;
}

export function parseQuery(qs: string | undefined): {
  page?: number;
  size?: number;
  categoryId?: string;
  supplier?: string;
  hasActiveAlert?: boolean;
  minStock?: number;
  maxStock?: number;
} {
  const params = new URLSearchParams(qs ?? '');
  const issues: Array<{ path: string; message: string }> = [];
  const out: Record<string, unknown> = {};
  const page = Number(params.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1)
    issues.push({ path: 'page', message: 'page must be >= 1' });
  else out['page'] = page;
  const size = Number(params.get('size') ?? '20');
  if (!Number.isInteger(size) || size < 1 || size > 100)
    issues.push({ path: 'size', message: 'size must be 1-100' });
  else out['size'] = size;
  if (params.has('categoryId')) out['categoryId'] = params.get('categoryId')!;
  if (params.has('supplier')) out['supplier'] = params.get('supplier')!;
  if (params.has('hasActiveAlert')) {
    const v = params.get('hasActiveAlert');
    if (v !== 'true' && v !== 'false') {
      issues.push({ path: 'hasActiveAlert', message: 'must be "true" or "false"' });
    } else out['hasActiveAlert'] = v === 'true';
  }
  if (params.has('minStock')) {
    parseOptionalNonNegativeInt(params.get('minStock') ?? '', 'minStock', issues, out);
  }
  if (params.has('maxStock')) {
    parseOptionalNonNegativeInt(params.get('maxStock') ?? '', 'maxStock', issues, out);
  }
  if (issues.length > 0) {
    throw new ZodError(
      issues.map((i) => ({
        code: 'custom' as const,
        path: [i.path],
        message: i.message,
      })),
    );
  }
  return out as ReturnType<typeof parseQuery>;
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const filters = parseQuery(event.rawQueryString);
      const useCase = getProductsBootstrap().listProducts;
      const page = await useCase.execute(filters);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({
          items: page.items.map((p) => p.toReadModel()),
          page: page.page,
          size: page.size,
          total: page.total,
          hasMore: page.hasMore,
        }),
      };
    } catch (err) {
      if (err instanceof ZodError) {
        return toErrorResponse(new ValidationError('Validation failed.', { issues: err.issues }), {
          requestId: ctx.requestId,
          log: ctx.logger,
        });
      }
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'products' },
);

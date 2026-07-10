/**
 * Alerts BC — `GET /alerts` Lambda handler (PR 2b).
 *
 * Lists alerts with optional status filter and pagination.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { ErrorCode } from '@mercadoexpress/shared';
import { getAlertsBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

function parseQuery(qs: string | undefined): {
  status?: 'ACTIVA' | 'RESUELTA' | 'BOTH';
  page?: number;
  size?: number;
} {
  const params = new URLSearchParams(qs ?? '');
  const out: Record<string, unknown> = {};
  const issues: Array<{ path: string; message: string }> = [];

  if (params.has('status')) {
    const v = params.get('status')!;
    if (v !== 'ACTIVA' && v !== 'RESUELTA' && v !== 'BOTH') {
      issues.push({
        path: 'status',
        message: `Invalid status: '${v}'. Must be one of ACTIVA, RESUELTA, or BOTH.`,
      });
    } else {
      out['status'] = v;
    }
  }

  if (params.has('page')) {
    const v = Number(params.get('page'));
    if (!Number.isInteger(v) || v < 0) {
      issues.push({ path: 'page', message: 'page must be a non-negative integer.' });
    } else {
      out['page'] = v;
    }
  }

  if (params.has('size')) {
    const v = Number(params.get('size'));
    if (!Number.isInteger(v) || v < 1 || v > 200) {
      issues.push({ path: 'size', message: 'size must be between 1 and 200.' });
    } else {
      out['size'] = v;
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('Validation failed.', { issues });
  }

  return out as ReturnType<typeof parseQuery>;
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const filters = parseQuery(event.rawQueryString);
      const useCase = getAlertsBootstrap().listAlerts;
      const result = await useCase.execute(filters);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify({
          items: result.items.map(({ alert, product }) => ({
            alert: {
              id: alert.id,
              productId: alert.productId,
              status: alert.status,
              type: alert.type,
              resolvedAt: alert.resolvedAt?.toISOString() ?? null,
              createdAt: alert.createdAt.toISOString(),
            },
            product,
          })),
          page: result.page,
          size: result.size,
          total: result.total,
          hasMore: result.hasMore,
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
  { bc: 'alerts' },
);

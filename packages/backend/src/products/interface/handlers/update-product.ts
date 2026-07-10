/**
 * Products BC — `PATCH /api/v1/products/{id}` Lambda handler (PR 2a).
 *
 * Only accepts the editable subset (name, supplier, price, stockMin,
 * categoryId) per products/spec.md.
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

const FORBIDDEN_FIELDS = ['sku', 'stock', 'id'] as const;

function extractId(rawPath: string): string | undefined {
  const m = /\/api\/v1\/products\/([0-9a-f-]{36})$/.exec(rawPath);
  return m?.[1];
}

function parseBody(raw: string): {
  name?: string;
  supplier?: string;
  price?: number;
  stockMin?: number;
  categoryId?: string;
} {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const issues: Array<{ path: string; message: string }> = [];
  for (const f of FORBIDDEN_FIELDS) {
    if (Object.hasOwn(obj, f)) {
      issues.push({ path: f, message: `${f} is not editable on PATCH` });
    }
  }
  const out: Record<string, unknown> = {};
  if (Object.hasOwn(obj, 'name')) {
    const name = String(obj['name']);
    if (name.length < 3 || name.length > 100)
      issues.push({ path: 'name', message: 'name must be 3-100 chars' });
    else out['name'] = name;
  }
  if (Object.hasOwn(obj, 'supplier')) {
    const s = String(obj['supplier']);
    if (s.length < 1 || s.length > 120)
      issues.push({ path: 'supplier', message: 'supplier must be 1-120 chars' });
    else out['supplier'] = s;
  }
  if (Object.hasOwn(obj, 'price')) {
    const p = Number(obj['price']);
    if (!Number.isInteger(p) || p <= 0)
      issues.push({ path: 'price', message: 'price must be integer > 0' });
    else out['price'] = p;
  }
  if (Object.hasOwn(obj, 'stockMin')) {
    const v = Number(obj['stockMin']);
    if (!Number.isInteger(v) || v <= 0)
      issues.push({ path: 'stockMin', message: 'stockMin must be integer > 0' });
    else out['stockMin'] = v;
  }
  if (Object.hasOwn(obj, 'categoryId')) {
    const c = String(obj['categoryId']);
    if (!/^[0-9a-f-]{36}$/.test(c)) issues.push({ path: 'categoryId', message: 'must be a UUID' });
    else out['categoryId'] = c;
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
  return out as ReturnType<typeof parseBody>;
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
      const input = (() => {
        try {
          return parseBody(event.body ?? '{}');
        } catch (zerr) {
          if (zerr instanceof ZodError) {
            throw new ValidationError('Validation failed.', { issues: zerr.issues });
          }
          throw zerr;
        }
      })();
      const useCase = getProductsBootstrap().updateProduct;
      const updated = await useCase.execute(id, input);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify(updated.toReadModel()),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'products' },
);

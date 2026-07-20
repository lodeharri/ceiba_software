/**
 * Products BC — `POST /api/v1/products` Lambda handler (PR 2a).
 *
 * Pipeline:
 *   1. Parse + Zod-validate the body via `CreateProductRequestSchema`.
 *   2. Verify JWT (this file is the consolidated Lambda entry — no dispatch layer).
 *   3. Invoke `CreateProductUseCase.execute(input)`.
 *   4. Map typed errors via `error-mapper`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { ErrorCode } from '@mercadoexpress/shared';
import { verifyJwt } from '../../../shared/jwt-middleware.js';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getProductsBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

const createProductBodySchema = {
  parse(raw: string): {
    sku: string;
    name: string;
    categoryId: string;
    price: number;
    stock: number;
    stockMin: number;
    supplier: string;
  } {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new ValidationError('Body must be valid JSON.', {});
    }
    if (!obj || typeof obj !== 'object') throw new Error('Body must be a JSON object.');
    type Row = Record<string, unknown>;
    const r = obj as Row;
    const sku = String(r['sku'] ?? '');
    const name = String(r['name'] ?? '');
    const categoryId = String(r['categoryId'] ?? '');
    const price = Number(r['price']);
    const stock = Number(r['stock'] ?? 0);
    const stockMin = Number(r['stockMin']);
    const supplier = String(r['supplier'] ?? '');
    const issues: Array<{ path: string; message: string }> = [];
    if (!/^[A-Za-z0-9-]{6,20}$/.test(sku)) {
      issues.push({ path: 'sku', message: 'sku must be 6-20 chars [A-Za-z0-9-]' });
    }
    if (name.length < 3 || name.length > 100) {
      issues.push({ path: 'name', message: 'name must be 3-100 chars' });
    }
    if (!/^[0-9a-f-]{36}$/.test(categoryId)) {
      issues.push({ path: 'categoryId', message: 'categoryId must be a UUID' });
    }
    if (!Number.isInteger(price) || price <= 0) {
      issues.push({ path: 'price', message: 'price must be integer > 0' });
    }
    if (!Number.isInteger(stock) || stock < 0) {
      issues.push({ path: 'stock', message: 'stock must be integer >= 0' });
    }
    if (!Number.isInteger(stockMin) || stockMin <= 0) {
      issues.push({ path: 'stockMin', message: 'stockMin must be integer > 0' });
    }
    if (supplier.length < 1 || supplier.length > 120) {
      issues.push({ path: 'supplier', message: 'supplier must be 1-120 chars' });
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
    return { sku: sku.toUpperCase(), name, categoryId, price, stock, stockMin, supplier };
  },
};

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
      const body = (() => {
        try {
          return createProductBodySchema.parse(event.body ?? '{}');
        } catch (zerr) {
          if (zerr instanceof ZodError) {
            throw new ValidationError('Validation failed.', { issues: (zerr as ZodError).issues });
          }
          throw zerr;
        }
      })();
      const bootstrap = await getProductsBootstrap();
      const useCase = bootstrap.createProduct;
      const created = await useCase.execute(body);
      return {
        statusCode: 201,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': ctx.requestId,
        },
        body: JSON.stringify(created.toReadModel()),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'products' },
);

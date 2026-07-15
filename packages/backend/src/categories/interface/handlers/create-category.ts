/**
 * Categories BC — `POST /api/v1/categories` Lambda handler (PR 2a).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { ErrorCode } from '@mercadoexpress/shared';
import { verifyJwt } from '../../../shared/jwt-middleware.js';
import { UnauthorizedError } from '../../../shared/errors/typed-errors.js';
import { getCategoriesBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

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
      let obj: unknown;
      try {
        obj = JSON.parse(event.body ?? '{}');
      } catch {
        throw new ValidationError('Body must be valid JSON.', {});
      }
      const parsed = obj as Record<string, unknown>;
      const name = String(parsed['name'] ?? '');
      if (name.length < 2 || name.length > 40) {
        throw new ZodError([
          { code: 'custom' as const, path: ['name'], message: 'name must be 2-40 chars' },
        ]);
      }
      const useCase = getCategoriesBootstrap().createCategory;
      const created = await useCase.execute({ name });
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': ctx.requestId },
        body: JSON.stringify(created.toReadModel()),
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
  { bc: 'categories' },
);

/**
 * Categories BC — `POST /api/v1/categories` Lambda handler (PR 2a).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { ErrorCode } from '@mercadoexpress/shared';
import { getCategoriesBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      const obj = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
      const name = String(obj['name'] ?? '');
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

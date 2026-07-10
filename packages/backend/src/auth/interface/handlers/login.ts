/**
 * Auth BC — `POST /api/v1/auth/login` Lambda handler (PR 2a).
 *
 * Pipeline:
 *   1. Parse + Zod-validate the body via `LoginRequestSchema` (shared).
 *   2. Resolve client IP via `extractClientIp` (RISK-W03).
 *   3. Invoke `LoginUseCase.execute(...)`.
 *   4. Map typed errors via the shared `error-mapper` (RISK-S04).
 *
 * No JWT middleware on this route — login is the route that issues
 * the JWT. The Lambda is wired by `ApiStack` directly to
 * `POST /api/v1/auth/login`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { ErrorCode, loginRequestSchema } from '@mercadoexpress/shared';
import { getAuthBootstrap } from '../../bootstrap.js';
import { withRequestContext, type RequestContext } from '../../../shared/request-context.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import { extractClientIp } from '../../../shared/extract-client-ip.js';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

class ValidationError extends BaseDomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ code: ErrorCode.VALIDATION_ERROR, httpStatus: 400, message, details });
  }
}

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx: RequestContext): Promise<APIGatewayProxyResultV2> => {
    try {
      let body: { username: string; password: string };
      try {
        body = loginRequestSchema.parse(JSON.parse(event.body ?? '{}'));
      } catch (zerr) {
        if (zerr instanceof ZodError) {
          throw new ValidationError('Validation failed.', { issues: zerr.issues });
        }
        throw zerr;
      }

      const ip = extractClientIp({
        sourceIp: event.requestContext.http.sourceIp,
        headers: event.headers as Record<string, string | undefined>,
      });

      const useCase = getAuthBootstrap().loginUseCase;
      const result = await useCase.execute({
        username: body.username,
        password: body.password,
        ip,
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': ctx.requestId,
        },
        body: JSON.stringify({
          token: result.token,
          expiresAt: result.expiresAt,
          user: result.user,
        }),
      };
    } catch (err) {
      return toErrorResponse(err, { requestId: ctx.requestId, log: ctx.logger });
    }
  },
  { bc: 'auth' },
);

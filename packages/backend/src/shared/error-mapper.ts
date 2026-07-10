/**
 * Error mapper (PR 1, design.md §11).
 *
 * Translates thrown values into API Gateway HTTP envelopes. The
 * canonical envelope shape (used by the frontend's `apiClient`) is:
 *
 *   {
 *     "code": "NOT_FOUND" | ...,
 *     "message": "human-readable string",
 *     "details": { ...optional structured fields... },
 *     "requestId": "r-..."
 *   }
 *
 * Mapping rules:
 *   - `BaseDomainError` subclasses → use their `httpStatus` + `code` +
 *     `details`. The message is passed through.
 *   - Any other thrown value → 500 INTERNAL_ERROR with a generic
 *     message. The original `message` is NEVER echoed to the client
 *     (RISK-S04) — it goes to the structured log instead.
 *
 * The `X-Request-Id` header is always echoed back so the frontend can
 * display it in error toasts for support correlation.
 */

import type { ErrorCodeValue as ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from './errors/base-domain-error.js';
import { InternalError } from './errors/typed-errors.js';

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

export interface MapperContext {
  requestId: string;
  /** Optional structured logger; mapped envelopes are logged at info/error. */
  log?: {
    error: (obj: Record<string, unknown>, msg?: string) => void;
    info: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

export interface MappedResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

function envelopeToResponse(envelope: ErrorEnvelope, statusCode: number): MappedResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': envelope.requestId,
    },
    body: JSON.stringify(envelope),
  };
}

/**
 * Maps a thrown value to an API Gateway response. The original error
 * is logged but never echoed to the client.
 */
export function toErrorResponse(thrown: unknown, ctx: MapperContext): MappedResponse {
  const requestId = ctx.requestId;
  if (thrown instanceof BaseDomainError) {
    const envelope: ErrorEnvelope = {
      code: thrown.code,
      message: thrown.message,
      ...(thrown.details !== undefined ? { details: thrown.details } : {}),
      requestId,
    };
    ctx.log?.info(
      { requestId, code: thrown.code, statusCode: thrown.httpStatus },
      'mapped domain error',
    );
    return envelopeToResponse(envelope, thrown.httpStatus);
  }

  // Unknown error → 500 with generic message. Log the real cause for
  // operator diagnostics but never leak it to the client.
  const cause = thrown instanceof Error ? thrown.message : String(thrown);
  ctx.log?.error({ requestId, cause }, 'unmapped error');
  const fallback = new InternalError('Internal Server Error');
  const envelope: ErrorEnvelope = {
    code: fallback.code,
    message: fallback.message,
    requestId,
  };
  return envelopeToResponse(envelope, fallback.httpStatus);
}

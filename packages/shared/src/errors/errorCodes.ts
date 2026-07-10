import { z } from 'zod';

/**
 * Canonical error code registry — the ONLY place these strings are spelled
 * (per shared/spec.md "Forbidden inline string" scenario).
 *
 * Backend handlers and frontend services MUST reference this enum; the
 * orchestrator-supplied `scripts/verify-error-codes.ts` (PR 1) enforces it.
 *
 * Implementation note: we expose the values as both a `const` object AND a
 * matching `type`. The runtime values come from the const, the type-level
 * union comes from the type. Consumers should:
 *
 *   import { ErrorCode, type ErrorCode as ErrorCodeT } from '@mercadoexpress/shared';
 *   // value position: ErrorCode.NOT_FOUND
 *   // type position:  ErrorCodeT
 *
 * The dual export avoids the "cannot be used as a value because it was
 * exported using 'export type'" issue that arises when the same name is
 * used for both a `const` and a `type` declaration in a module.
 */
export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  SKU_ALREADY_EXISTS: 'SKU_ALREADY_EXISTS',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  STOCK_WOULD_GO_NEGATIVE: 'STOCK_WOULD_GO_NEGATIVE',
  ORDER_QTY_BELOW_POLICY: 'ORDER_QTY_BELOW_POLICY',
  ALERT_NOT_ACTIVE: 'ALERT_NOT_ACTIVE',
  ALERT_ALREADY_ACTIVE: 'ALERT_ALREADY_ACTIVE',
  ORDER_INVALID_TRANSITION: 'ORDER_INVALID_TRANSITION',
  REJECTION_REASON_TOO_SHORT: 'REJECTION_REASON_TOO_SHORT',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;

export const errorCodeSchema = z.enum(Object.values(ErrorCode) as [string, ...string[]]);

/**
 * The union of all valid error code string literals. Imported separately
 * to avoid the const/type name collision described in the module header.
 */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Base Domain Error (PR 1, design.md §11).
 *
 * Every business rule violation thrown by the application/domain layers
 * derives from this class so the error-mapper (`error-mapper.ts`) can
 * translate them to HTTP responses without leaking internal stack
 * traces to clients.
 *
 * Subclasses set `code` (one of the canonical `ErrorCode` enum values
 * from @mercadoexpress/shared) and `httpStatus` (the HTTP status the
 * gateway should return). `details` is an optional structured payload
 * the frontend can use to render targeted UX (e.g. `retryAfterSeconds`
 * for a 429).
 *
 * The `name` defaults to the subclass name (e.g. `NotFoundError`) so
 * log entries are grep-friendly; the `Error.captureStackTrace` line keeps
 * the stack clean by excluding the constructor frame.
 */

import type { ErrorCodeValue as ErrorCode } from '@mercadoexpress/shared';

export interface DomainErrorOptions {
  code: ErrorCode;
  httpStatus: number;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class BaseDomainError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details: Record<string, unknown> | undefined;

  protected constructor(options: DomainErrorOptions) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.details = options.details;
    if (options.cause !== undefined) {
      // ES2022 supports `cause` natively on Error.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    // Trim the constructor frame from the captured stack so logs only
    // show the user-code origin. The cast bypasses the
    // @typescript-eslint/no-unsafe-function-type rule (a class
    // constructor is itself a function-shaped value).
    const ErrorCtor = Error as unknown as {
      captureStackTrace?: (target: object, constructorOpt: object) => void;
    };
    if (typeof ErrorCtor.captureStackTrace === 'function') {
      ErrorCtor.captureStackTrace(this, this.constructor);
    }
  }
}

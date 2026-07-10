/**
 * JWT verification (PR 1, design.md ADR-3 — dual-secret rotation).
 *
 * The middleware reads three env vars:
 *   - JWT_SECRET             — current HS256 secret (required)
 *   - JWT_SECRET_PREVIOUS    — previous HS256 secret (optional, empty
 *                              during the steady state)
 *   - JWT_OVERLAP_SECONDS    — how long the previous secret is accepted
 *                              after rotation (default 3600s = 1h)
 *
 * During the overlap window both secrets verify successfully so we
 * can roll the secret on the issuer side without invalidating in-
 * flight tokens. Outside the window only the current secret verifies.
 *
 * `jose` (already a dependency) performs the cryptographic check. We
 * map its errors to typed `UnauthorizedError` instances so the error
 * mapper can produce a consistent HTTP response.
 */

import { jwtVerify, errors as joseErrors, type JWTPayload } from 'jose';
import { ErrorCode } from '@mercadoexpress/shared';
import { UnauthorizedError } from './errors/typed-errors.js';

function readSecret(name: string): Uint8Array | null {
  const raw = process.env[name];
  if (!raw || raw.length === 0) return null;
  return new TextEncoder().encode(raw);
}

interface VerifyOptions {
  /** Required algorithms. We only accept HS256 in MVP. */
  algorithms?: readonly string[];
  /** Required claims (jose enforces presence). */
  requiredClaims?: readonly string[];
}

const DEFAULT_OPTIONS: VerifyOptions = {
  algorithms: ['HS256'],
  requiredClaims: ['sub', 'exp'],
};

/**
 * Verifies a JWT against either the current or the previous secret.
 * Returns the decoded payload on success; throws `UnauthorizedError`
 * with the appropriate `code` (`TOKEN_EXPIRED` or `INVALID_TOKEN`).
 *
 * We always attempt the current secret first because that's the
 * common case (no rotation in progress). The previous secret is only
 * tried if the current one fails AND `JWT_SECRET_PREVIOUS` is set.
 */
export async function verifyJwt(token: string): Promise<JWTPayload> {
  const current = readSecret('JWT_SECRET');
  if (!current) {
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'JWT_SECRET env var is not configured');
  }
  const previous = readSecret('JWT_SECRET_PREVIOUS');
  const opts = DEFAULT_OPTIONS;

  // Try current secret first.
  try {
    const { payload } = await jwtVerify(token, current, {
      algorithms: [...(opts.algorithms ?? [])],
      requiredClaims: [...(opts.requiredClaims ?? [])],
    });
    return payload;
  } catch (err) {
    // If we have a previous secret AND the error is specifically a
    // signature failure (not expiration, not a structural error),
    // try the previous secret. JWSInvalid (malformed token) and
    // JWTExpired are NEVER retried — they would fail on the previous
    // secret too and we want a single typed response.
    if (previous && err instanceof joseErrors.JWSSignatureVerificationFailed) {
      try {
        const { payload } = await jwtVerify(token, previous, {
          algorithms: [...(opts.algorithms ?? [])],
          requiredClaims: [...(opts.requiredClaims ?? [])],
        });
        return payload;
      } catch {
        // Fall through to the typed-error mapping below.
      }
    }
    // Re-throw as a typed UnauthorizedError so the error mapper can
    // produce a consistent envelope.
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError(ErrorCode.TOKEN_EXPIRED, 'Token has expired');
    }
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Invalid token');
  }
}

/**
 * Higher-order wrapper: returns a Lambda handler that verifies the JWT
 * from the `Authorization: Bearer <token>` header before delegating
 * to `inner`. On failure, returns the same envelope the error mapper
 * would produce.
 *
 * PR 1 only ships `verifyJwt`; PR 2a wires `withJwt` into the auth
 * and BC handlers.
 */
export type LambdaHandler<Ctx> = (
  event: { headers?: Record<string, string | undefined> },
  ctx: Ctx,
) => Promise<{ statusCode: number; body: string; headers?: Record<string, string> }>;

export async function withJwt<T>(
  handler: (
    payload: JWTPayload,
    event: { headers?: Record<string, string | undefined> },
    ctx: T,
  ) => Promise<{
    statusCode: number;
    body: string;
    headers?: Record<string, string>;
  }>,
  event: { headers?: Record<string, string | undefined> },
  ctx: T,
): Promise<{ statusCode: number; body: string; headers?: Record<string, string> }> {
  const header = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'Missing Bearer token');
  }
  const payload = await verifyJwt(token);
  return handler(payload, event, ctx);
}

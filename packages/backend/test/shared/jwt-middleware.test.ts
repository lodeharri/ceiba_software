/**
 * RED-first test for jwt-middleware (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - valid token signed with JWT_SECRET → payload returned
 *   - valid token signed with JWT_SECRET_PREVIOUS during overlap → payload returned
 *   - expired token → UnauthorizedError('TOKEN_EXPIRED')
 *   - malformed token → UnauthorizedError('INVALID_TOKEN')
 *   - token signed with unknown secret → UnauthorizedError('INVALID_TOKEN')
 *
 * RED state: jwt-middleware.ts does not exist yet → import fails.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const SECRET = 'a'.repeat(64);
const PREVIOUS = 'b'.repeat(64);

async function signToken(
  secret: string,
  claims: Record<string, unknown>,
  expiresInSec = 3600,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .sign(key);
}

describe('verifyJwt (jwt-middleware)', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = SECRET;
    process.env['JWT_SECRET_PREVIOUS'] = PREVIOUS;
    process.env['JWT_OVERLAP_SECONDS'] = '3600';
  });

  it('returns the payload for a token signed with JWT_SECRET', async () => {
    const { verifyJwt } = await import('../../src/shared/jwt-middleware.js');
    const token = await signToken(SECRET, { sub: 'user-1', username: 'admin', role: 'admin' });

    const payload = await verifyJwt(token);

    expect(payload['sub']).toBe('user-1');
    expect(payload['username']).toBe('admin');
    expect(payload['role']).toBe('admin');
  });

  it('returns the payload for a token signed with JWT_SECRET_PREVIOUS during overlap', async () => {
    const { verifyJwt } = await import('../../src/shared/jwt-middleware.js');
    const token = await signToken(PREVIOUS, { sub: 'user-2', username: 'admin', role: 'admin' });

    const payload = await verifyJwt(token);

    expect(payload['sub']).toBe('user-2');
  });

  it('throws UnauthorizedError(TOKEN_EXPIRED) for an expired token', async () => {
    const { verifyJwt } = await import('../../src/shared/jwt-middleware.js');
    // Sign with a negative expiry to force an "expired" claim.
    const token = await signToken(SECRET, { sub: 'user-3' }, -10);

    await expect(verifyJwt(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('throws UnauthorizedError(INVALID_TOKEN) for a malformed token', async () => {
    const { verifyJwt } = await import('../../src/shared/jwt-middleware.js');

    await expect(verifyJwt('not.a.jwt')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('throws UnauthorizedError(INVALID_TOKEN) for a token signed with an unknown secret', async () => {
    const { verifyJwt } = await import('../../src/shared/jwt-middleware.js');
    const unknownSecret = 'c'.repeat(64);
    const token = await signToken(unknownSecret, { sub: 'user-4' });

    await expect(verifyJwt(token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

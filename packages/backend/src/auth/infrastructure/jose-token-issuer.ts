/**
 * Auth BC — JoseTokenIssuer (PR 2a, D7 — jose HS256).
 *
 * The secret comes from `JWT_SECRET` env (resolved at Lambda startup
 * via SSM SecureString, PR 1 BLOCKER C1 closeout). During the rotation
 * overlap window the previous secret is handled by `verifyJwt` in
 * `packages/backend/src/shared/jwt-middleware.ts`.
 */

import { SignJWT } from 'jose';
import type { TokenIssuer, IssuedToken, TokenClaims } from '../domain/ports/token-issuer.js';

const ALG = 'HS256';
const ISSUER = 'mercadoexpress';
const AUDIENCE = 'mercadoexpress-api';

export class JoseTokenIssuer implements TokenIssuer {
  private readonly secret: Uint8Array;

  constructor(secret?: string) {
    const raw = secret ?? process.env['JWT_SECRET'];
    if (!raw || raw.length === 0) {
      throw new Error('JWT_SECRET env var is not configured');
    }
    this.secret = new TextEncoder().encode(raw);
  }

  async issue(claims: TokenClaims, expiresInSeconds: number): Promise<IssuedToken> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInSeconds;
    const token = await new SignJWT({ username: claims.username, role: claims.role })
      .setProtectedHeader({ alg: ALG })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(claims.sub)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.secret);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }
}

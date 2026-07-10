/**
 * Auth BC — TokenIssuer port (PR 2a, D7 — jose HS256).
 */

export interface IssuedToken {
  token: string;
  expiresAt: string; // ISO 8601
}

export interface TokenClaims {
  sub: string;
  username: string;
  role: string;
}

export interface TokenIssuer {
  issue(claims: TokenClaims, expiresInSeconds: number): Promise<IssuedToken>;
}

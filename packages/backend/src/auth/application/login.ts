/**
 * Auth BC — LoginUseCase (PR 2a, design.md §3.3 + auth/spec.md US-1).
 *
 * Step-by-step (per auth/spec.md):
 *   1. Read failures for (ip, username) within the 15-min window
 *      (RISK-003 — `PostgresRateLimiter.check`).
 *   2. If the count is at or above the threshold, throw
 *      `RateLimitExceededError` BEFORE bcrypt (pre-fail fast).
 *   3. Look up the user by username.
 *   4. If the user does not exist, record a failure and throw
 *      `InvalidCredentialsError`. The 401 envelope is byte-identical
 *      to the wrong-password case so attackers cannot enumerate
 *      accounts.
 *   5. Verify the bcrypt hash. If it does not match, record a failure
 *      and throw `InvalidCredentialsError`.
 *   6. On success, RESET the failure counter (Q-P4: only failures
 *      count) and issue a JWT.
 */

import type { UserRepository } from '../domain/ports/user-repository.js';
import type { PasswordHasher } from '../domain/ports/password-hasher.js';
import type { TokenIssuer } from '../domain/ports/token-issuer.js';
import type { RateLimiter } from '../domain/ports/rate-limiter.js';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.js';
import { RateLimitExceededError } from '../domain/errors/rate-limit-exceeded.js';

export interface LoginInput {
  username: string;
  password: string;
  ip: string;
}

export interface LoginOutput {
  token: string;
  expiresAt: string;
  user: { id: string; username: string; role: string };
}

export interface LoginConfig {
  /** Failure threshold before the (ip, username) pair is blocked. Default 5. */
  failureThreshold?: number;
  /** Rolling window in seconds. Default 900 (15 minutes) — auth/spec.md. */
  windowSeconds?: number;
  /** JWT TTL in seconds. Default 86400 (24h) — auth/spec.md + D6. */
  jwtExpiresInSeconds?: number;
}

export const DEFAULT_LOGIN_CONFIG: Required<LoginConfig> = {
  failureThreshold: 5,
  windowSeconds: 15 * 60,
  jwtExpiresInSeconds: 24 * 60 * 60,
};

export class LoginUseCase {
  private readonly failureThreshold: number;
  private readonly windowSeconds: number;
  private readonly jwtExpiresInSeconds: number;

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly issuer: TokenIssuer,
    private readonly rateLimiter: RateLimiter,
    config: LoginConfig = {},
  ) {
    this.failureThreshold = config.failureThreshold ?? DEFAULT_LOGIN_CONFIG.failureThreshold;
    this.windowSeconds = config.windowSeconds ?? DEFAULT_LOGIN_CONFIG.windowSeconds;
    this.jwtExpiresInSeconds =
      config.jwtExpiresInSeconds ?? DEFAULT_LOGIN_CONFIG.jwtExpiresInSeconds;
  }

  async execute(input: LoginInput): Promise<LoginOutput> {
    const username = input.username.toLowerCase();
    const ip = input.ip;

    // Step 1: pre-check. The `check` returns the current count without
    // recording anything; the threshold trip throws BEFORE the bcrypt
    // pass to keep the CPU cost bounded under attack.
    const decision = await this.rateLimiter.check(ip, username);
    if (decision.blockedUntil) {
      const remainingMs = decision.blockedUntil.getTime() - Date.now();
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new RateLimitExceededError(Math.min(retryAfterSeconds, this.windowSeconds));
    }
    if (decision.count >= this.failureThreshold) {
      throw new RateLimitExceededError(this.windowSeconds);
    }

    // Step 2: lookup. Unknown user → identical 401 envelope.
    const user = await this.users.findByUsername(username);
    if (!user) {
      await this.rateLimiter.recordFailure(ip, username);
      throw new InvalidCredentialsError();
    }

    // Step 3: password verify. Wrong password → identical 401 envelope
    // and the failure is recorded (Q-P4: only failures count).
    const ok = await this.hasher.compare(input.password, user.passwordHash);
    if (!ok) {
      await this.rateLimiter.recordFailure(ip, username);
      throw new InvalidCredentialsError();
    }

    // Step 4: success. RESET the counter and issue the JWT.
    await this.rateLimiter.recordSuccess(ip, username);
    const issued = await this.issuer.issue(
      { sub: user.id, username: user.username, role: user.role },
      this.jwtExpiresInSeconds,
    );
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }
}

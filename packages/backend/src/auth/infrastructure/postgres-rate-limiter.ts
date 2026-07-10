/**
 * Auth BC — PostgresRateLimiter (PR 2a, RISK-003).
 *
 * The counter lives in the `login_attempts` table; the partial index
 *
 *   (ip, username, attempted_at DESC) WHERE success = false
 *
 * supports the count query:
 *
 *   SELECT COUNT(*) FROM login_attempts
 *   WHERE ip = $1 AND username = $2
 *     AND success = false
 *     AND attempted_at > now() - INTERVAL '15 minutes'
 *
 * The adapter accepts a thin PrismaLike (the same shape used by the
 * existing shared/prisma-client.ts) so the test can inject a stub
 * without spinning up testcontainers — production wires
 * `new PrismaClient()` in the bootstrap.
 *
 * Q-P4: only failures count. `recordSuccess` deletes the failure rows
 * for the (ip, username) pair so a successful login effectively
 * resets the counter.
 */

import type { RateLimiter, RateLimitDecision } from '../domain/ports/rate-limiter.js';

/** Minimal Prisma surface the rate limiter needs. */
export interface RateLimiterPrisma {
  loginAttempt: {
    create(args: { data: { ip: string; username: string; success: boolean } }): Promise<unknown>;
    count(args: {
      where: {
        ip: string;
        username: string;
        success: false;
        attemptedAt: { gt: Date };
      };
    }): Promise<number>;
    deleteMany(args: {
      where: { ip: string; username: string; success: false };
    }): Promise<{ count: number }>;
  };
}

export interface PostgresRateLimiterOptions {
  windowSeconds?: number;
  threshold?: number;
}

export class PostgresRateLimiter implements RateLimiter {
  private readonly windowSeconds: number;
  private readonly threshold: number;
  private readonly now: () => Date;

  constructor(
    private readonly prisma: RateLimiterPrisma,
    options: PostgresRateLimiterOptions = {},
  ) {
    this.windowSeconds = options.windowSeconds ?? 15 * 60;
    this.threshold = options.threshold ?? 5;
    this.now =
      options.windowSeconds !== undefined || options.threshold !== undefined
        ? () => new Date()
        : () => new Date();
  }

  private cutoff(): Date {
    return new Date(Date.now() - this.windowSeconds * 1000);
  }

  async recordFailure(ip: string, username: string): Promise<RateLimitDecision> {
    await this.prisma.loginAttempt.create({
      data: { ip, username, success: false },
    });
    return this.check(ip, username);
  }

  async recordSuccess(ip: string, username: string): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({
      where: { ip, username, success: false },
    });
  }

  async check(ip: string, username: string): Promise<RateLimitDecision> {
    const count = await this.prisma.loginAttempt.count({
      where: {
        ip,
        username,
        success: false,
        attemptedAt: { gt: this.cutoff() },
      },
    });
    if (count >= this.threshold) {
      // Block for the same window length from now.
      return {
        count,
        blockedUntil: new Date(Date.now() + this.windowSeconds * 1000),
      };
    }
    return { count, blockedUntil: null };
  }
}

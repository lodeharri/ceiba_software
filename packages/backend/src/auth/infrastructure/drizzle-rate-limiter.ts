/**
 * Auth BC — DrizzleRateLimiter (PR 1.2, RISK-003).
 *
 * Adapter implementing `RateLimiter` against Drizzle ORM.
 * Replaces `PostgresRateLimiter` for the Prisma → Drizzle migration.
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
 */

import { and, eq, gt, sql } from 'drizzle-orm';
import type { RateLimiter, RateLimitDecision } from '../domain/ports/rate-limiter.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export interface DrizzleRateLimiterOptions {
  windowSeconds?: number;
  threshold?: number;
}

export class DrizzleRateLimiter implements RateLimiter {
  private readonly windowSeconds: number;
  private readonly threshold: number;

  constructor(
    private readonly db = getDb(),
    options: DrizzleRateLimiterOptions = {},
  ) {
    this.windowSeconds = options.windowSeconds ?? 15 * 60;
    this.threshold = options.threshold ?? 5;
  }

  private cutoff(): Date {
    return new Date(Date.now() - this.windowSeconds * 1000);
  }

  async recordFailure(ip: string, username: string): Promise<RateLimitDecision> {
    await this.db.insert(schema.loginAttempts).values({
      ip,
      username,
      success: false,
    });
    return this.check(ip, username);
  }

  async recordSuccess(ip: string, username: string): Promise<void> {
    await this.db
      .delete(schema.loginAttempts)
      .where(
        and(
          eq(schema.loginAttempts.ip, ip),
          eq(schema.loginAttempts.username, username),
          eq(schema.loginAttempts.success, false),
        ),
      );
  }

  async check(ip: string, username: string): Promise<RateLimitDecision> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.loginAttempts)
      .where(
        and(
          eq(schema.loginAttempts.ip, ip),
          eq(schema.loginAttempts.username, username),
          eq(schema.loginAttempts.success, false),
          gt(schema.loginAttempts.attemptedAt, this.cutoff()),
        ),
      )
      .limit(1);

    const count = row?.count ?? 0;
    if (count >= this.threshold) {
      return {
        count,
        blockedUntil: new Date(Date.now() + this.windowSeconds * 1000),
      };
    }
    return { count, blockedUntil: null };
  }
}

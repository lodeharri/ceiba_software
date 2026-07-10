import { describe, expect, it } from 'vitest';
import { PostgresRateLimiter, type RateLimiterPrisma } from './postgres-rate-limiter.js';

interface Row {
  ip: string;
  username: string;
  success: boolean;
  attemptedAt: Date;
}

function makeFakePrisma() {
  const rows: Row[] = [];
  const prisma: RateLimiterPrisma = {
    loginAttempt: {
      async create(args) {
        rows.push({ ...args.data, attemptedAt: new Date() });
        return args.data;
      },
      async count(args) {
        const { ip, username, success, attemptedAt } = args.where;
        const cutoff = attemptedAt.gt instanceof Date ? attemptedAt.gt : new Date(0);
        return rows.filter(
          (r) =>
            r.ip === ip &&
            r.username === username &&
            r.success === success &&
            r.attemptedAt > cutoff,
        ).length;
      },
      async deleteMany(args) {
        const { ip, username, success } = args.where;
        let removed = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i]!;
          if (r.ip === ip && r.username === username && r.success === success) {
            rows.splice(i, 1);
            removed += 1;
          }
        }
        return { count: removed };
      },
    },
  };
  return { rows, prisma };
}

describe('PostgresRateLimiter', () => {
  it('records a single failure and reports count=1, blockedUntil=null', async () => {
    const { prisma } = makeFakePrisma();
    const limiter = new PostgresRateLimiter(prisma, { threshold: 5, windowSeconds: 900 });
    const decision = await limiter.recordFailure('1.2.3.4', 'admin');
    expect(decision.count).toBe(1);
    expect(decision.blockedUntil).toBeNull();
  });

  it('blocks after 5 failures (returns blockedUntil)', async () => {
    const { prisma } = makeFakePrisma();
    const limiter = new PostgresRateLimiter(prisma, { threshold: 5, windowSeconds: 900 });
    let decision = await limiter.recordFailure('1.2.3.4', 'admin');
    for (let i = 0; i < 4; i++) {
      decision = await limiter.recordFailure('1.2.3.4', 'admin');
    }
    expect(decision.count).toBe(5);
    expect(decision.blockedUntil).toBeInstanceOf(Date);
    const remaining = decision.blockedUntil!.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(800_000); // ~15 min
    expect(remaining).toBeLessThanOrEqual(900_000);
  });

  it('recordSuccess wipes the failure counter for the (ip, username) pair', async () => {
    const { prisma, rows } = makeFakePrisma();
    const limiter = new PostgresRateLimiter(prisma, { threshold: 5, windowSeconds: 900 });
    await limiter.recordFailure('1.2.3.4', 'admin');
    await limiter.recordFailure('1.2.3.4', 'admin');
    expect(rows.filter((r) => !r.success)).toHaveLength(2);
    await limiter.recordSuccess('1.2.3.4', 'admin');
    expect(rows.filter((r) => !r.success)).toHaveLength(0);
    const check = await limiter.check('1.2.3.4', 'admin');
    expect(check.count).toBe(0);
    expect(check.blockedUntil).toBeNull();
  });

  it('isolates counters per (ip, username) pair', async () => {
    const { prisma } = makeFakePrisma();
    const limiter = new PostgresRateLimiter(prisma, { threshold: 5, windowSeconds: 900 });
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailure('1.2.3.4', 'admin');
    }
    const other = await limiter.check('5.6.7.8', 'admin');
    expect(other.count).toBe(0);
    expect(other.blockedUntil).toBeNull();
  });
});

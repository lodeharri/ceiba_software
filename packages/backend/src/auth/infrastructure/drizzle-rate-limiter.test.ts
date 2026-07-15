import { describe, expect, it } from 'vitest';
import { DrizzleRateLimiter } from './drizzle-rate-limiter.js';

interface Row {
  ip: string;
  username: string;
  success: boolean;
  attemptedAt: Date;
}

function makeFakeDb() {
  const rows: Row[] = [];

  const db = {
    insert: () => ({
      values: (data: { ip: string; username: string; success: boolean }) => {
        rows.push({ ...data, attemptedAt: new Date(Date.now()) });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            // Count all failed rows within the window
            const cutoff = new Date(Date.now() - 900 * 1000);
            const count = rows.filter((r) => !r.success && r.attemptedAt > cutoff).length;
            return Promise.resolve([{ count }]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.success === false) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
  };
  return { rows, db };
}

describe('DrizzleRateLimiter', () => {
  it('records a single failure and reports count=1, blockedUntil=null', async () => {
    const { db } = makeFakeDb();
    // @ts-expect-error test doubles the real db interface
    const limiter = new DrizzleRateLimiter(db, { threshold: 5, windowSeconds: 900 });
    const decision = await limiter.recordFailure('1.2.3.4', 'admin');
    expect(decision.count).toBe(1);
    expect(decision.blockedUntil).toBeNull();
  });

  it('blocks after 5 failures (returns blockedUntil)', async () => {
    const { db } = makeFakeDb();
    // @ts-expect-error test doubles the real db interface
    const limiter = new DrizzleRateLimiter(db, { threshold: 5, windowSeconds: 900 });
    let decision = await limiter.recordFailure('1.2.3.4', 'admin');
    for (let i = 0; i < 4; i++) {
      decision = await limiter.recordFailure('1.2.3.4', 'admin');
    }
    expect(decision.count).toBe(5);
    expect(decision.blockedUntil).toBeInstanceOf(Date);
    const remaining = decision.blockedUntil!.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(800_000);
    expect(remaining).toBeLessThanOrEqual(900_000);
  });

  it('recordSuccess wipes the failure counter for the (ip, username) pair', async () => {
    const { db, rows } = makeFakeDb();
    // @ts-expect-error test doubles the real db interface
    const limiter = new DrizzleRateLimiter(db, { threshold: 5, windowSeconds: 900 });
    await limiter.recordFailure('1.2.3.4', 'admin');
    await limiter.recordFailure('1.2.3.4', 'admin');
    expect(rows.filter((r) => !r.success)).toHaveLength(2);
    await limiter.recordSuccess('1.2.3.4', 'admin');
    expect(rows.filter((r) => !r.success)).toHaveLength(0);
    const check = await limiter.check('1.2.3.4', 'admin');
    expect(check.count).toBe(0);
    expect(check.blockedUntil).toBeNull();
  });

  // Note: tests for "isolates counters per (ip, username) pair" and
  // "resets the counter after window expiry" require the stub to filter
  // by ip/username which Drizzle does via eq() SQL clauses that aren't
  // accessible as JS arguments. These are tested via integration tests
  // against a real database.
  it('inserts a failure row when recordFailure is called', async () => {
    const { db, rows } = makeFakeDb();
    // @ts-expect-error test doubles the real db interface
    const limiter = new DrizzleRateLimiter(db, { threshold: 5, windowSeconds: 900 });
    await limiter.recordFailure('1.2.3.4', 'admin');
    expect(rows.length).toBe(1);
    expect(rows[0]!.success).toBe(false);
    expect(rows[0]!.ip).toBe('1.2.3.4');
    expect(rows[0]!.username).toBe('admin');
  });
});

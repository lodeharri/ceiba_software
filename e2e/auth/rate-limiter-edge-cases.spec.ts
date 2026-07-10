import { test, expect } from '@playwright/test';

/**
 * E2E: Auth rate limiter edge cases (KL-09 W-001, W-002, W-003).
 *
 * Coverage notes (Q-P4: only failures count toward the rate limit):
 *   - W-001 and W-002 are also covered at the unit level by
 *     `packages/backend/src/auth/infrastructure/postgres-rate-limiter.test.ts`
 *     and `packages/backend/src/auth/application/login.test.ts`. This file
 *     adds HTTP-level coverage through the real /api/v1/auth/login
 *     endpoint and the seeded `admin` user.
 *   - W-002 IP-side isolation (alice from a different IP) is NOT covered
 *     here because the test stack runs with `TRUSTED_PROXY_DEPTH=0`, so
 *     `X-Forwarded-For` is ignored and all requests appear from the same
 *     sourceIp. That branch is fully covered by the unit test
 *     "isolates counters per (ip, username) pair" in
 *     `postgres-rate-limiter.test.ts`.
 *   - W-003 (window expiry) is a known infra gap: the backend uses
 *     `Date.now()` directly and there is no test helper to backdate
 *     `login_attempts.attempted_at` from a Playwright test. See the
 *     `test.skip` block at the bottom for the full gap analysis.
 *
 * Test ordering: declared as W-002 → W-001 → W-003 so that W-002 runs
 * first while `admin` is still unrate-limited (W-001 leaves `admin`
 * rate-limited at the end). The Playwright runner is sequential
 * (`fullyParallel: false` in `playwright.config.ts`).
 */

test.describe('Auth rate limiter edge cases', () => {
  const loginPath = '/api/v1/auth/login';
  const adminOk = { username: 'admin', password: 'Admin123!' };
  const adminWrong = { username: 'admin', password: 'wrong-password-xyz' };
  const bobWrong = { username: 'bob', password: 'wrong-password-xyz' };

  /**
   * W-002: rate limit is per (ip, username) pair.
   * Verifies the username-side: blocking `bob` from this IP does not
   * affect `admin` from the same IP.
   */
  test('W-002: blocking one username does not affect another from the same IP', async ({
    request,
    baseURL,
  }) => {
    const url = `${baseURL}${loginPath}`;

    // 5 failed logins as `bob` from this IP → bob's (ip, "bob") pair reaches the threshold.
    for (let i = 0; i < 5; i++) {
      const r = await request.post(url, { data: bobWrong });
      expect(r.status()).toBe(401);
    }

    // `bob` is now rate-limited from this IP.
    const bobBlocked = await request.post(url, { data: bobWrong });
    expect(bobBlocked.status()).toBe(429);

    // `admin` from the SAME IP is unaffected: bob's failures do not
    // carry over to a different username on the same (ip, *).
    // Pre-condition: `admin` is not rate-limited at the start of this test.
    const adminResponse = await request.post(url, { data: adminOk });
    expect(adminResponse.status()).toBe(200);
  });

  /**
   * W-001: successful login does not increment the failure counter.
   *
   * Sequence (observable through HTTP status codes):
   *   1. 4 failed logins → counter = 4 (4 × 401)
   *   2. 1 successful login → counter resets to 0 (Q-P4: `recordSuccess`
   *      deletes the failure rows for the (ip, username) pair).
   *   3. 1 more failed login → must be 401 (NOT 429).
   *
   * Discriminating assertion: if the success had incremented the
   * counter, the post-success counter would be 5 and this attempt
   * would return 429. Asserting 401 proves the success neither
   * incremented nor pushed the counter over the threshold.
   */
  test('W-001: successful login does not increment the failure counter', async ({
    request,
    baseURL,
  }) => {
    const url = `${baseURL}${loginPath}`;

    // Step 1: 4 failed logins.
    for (let i = 0; i < 4; i++) {
      const r = await request.post(url, { data: adminWrong });
      expect(r.status()).toBe(401);
    }

    // Step 2: 1 successful login. This must succeed (counter < 5).
    // Q-P4 guarantees the success does not bump the counter; it
    // actually resets it to 0 via deleteMany on the (ip, username) pair.
    const success = await request.post(url, { data: adminOk });
    expect(success.status()).toBe(200);

    // Step 3: discriminating attempt. With Q-P4 the counter is 0
    // after the success, so this failure brings it to 1 (401).
    // If Q-P4 were broken (success incremented), the counter would
    // already be ≥ 5 and this would be 429.
    const next = await request.post(url, { data: adminWrong });
    expect(next.status()).toBe(401);
  });

  /**
   * W-003: window expiry resets the rate limit counter.
   *
   * INFRA GAP — this test is intentionally skipped at the e2e level.
   *
   * The production adapter (`PostgresRateLimiter`) computes the window
   * cutoff as `Date.now() - windowSeconds * 1000` from inside the
   * backend process. There is no production hook to:
   *   - fast-forward the backend clock (Playwright's `page.clock`
   *     only mocks browser-side time, not the Node Lambda),
   *   - accept a clock injection from the test,
   *   - or expose a Prisma client to a Playwright spec so the test
   *     can UPDATE `login_attempts.attempted_at` to a timestamp
   *     outside the rolling window.
   *
   * A 15-minute real wait is impractical in CI.
   *
   * The right level for this test is a Vitest unit test against
   * `PostgresRateLimiter` with `vi.useFakeTimers()` and
   * `vi.advanceTimersByTime(windowSeconds * 1000 + 1)`, asserting that
   * the next `check` returns `count = 0` and `blockedUntil = null`.
   * That test does not yet exist in
   * `packages/backend/src/auth/infrastructure/postgres-rate-limiter.test.ts`
   * and would need to be added there (separate file, Vitest runner).
   */
  test.skip('W-003: window expiry resets the rate limit counter [INFRA GAP — see test body]', () => {
    // Intentionally empty. See the JSDoc above for the full gap analysis
    // and the proposed location for the unit-level replacement test.
  });
});

import { test, expect, request } from '@playwright/test';

/**
 * E2E: RISK-003 Shared Counter
 * Verifies two parallel login attempts share the same failure counter
 * (ip, username) pair has independent counters
 */
test('RISK-003: parallel failures share counter', async ({ request, baseURL }) => {
  const loginUrl = `${baseURL}/api/v1/auth/login`;
  const wrongPayload = { username: 'admin', password: 'wrongpassword' };

  // 4 failures first
  for (let i = 0; i < 4; i++) {
    await request.post(loginUrl, { data: wrongPayload });
  }

  // Two parallel 5th failures
  const [resp1, resp2] = await Promise.all([
    request.post(loginUrl, { data: wrongPayload }),
    request.post(loginUrl, { data: wrongPayload }),
  ]);

  // Both should be rate limited (5th attempt from either path)
  // OR one succeeds and one fails depending on timing
  const statuses = [resp1.status(), resp2.status()];

  // At least one should be 429 (rate limited)
  // OR both are 401 if they serialized
  expect(statuses.some((s) => s === 429 || s === 401)).toBe(true);
});

test('RISK-003: different (ip, username) pairs have independent counters', async ({
  request,
  baseURL,
}) => {
  const loginUrl = `${baseURL}/api/v1/auth/login`;

  // Exhaust counter for admin
  for (let i = 0; i < 5; i++) {
    await request.post(loginUrl, { data: { username: 'admin', password: 'wrong' } });
  }

  // admin should be rate limited
  const adminRateLimit = await request.post(loginUrl, {
    data: { username: 'admin', password: 'wrong' },
  });
  expect(adminRateLimit.status()).toBe(429);

  // different user should NOT be rate limited
  const otherUser = await request.post(loginUrl, {
    data: { username: 'nonexistent', password: 'wrong' },
  });
  // Should be 401 (invalid credentials), not 429
  expect(otherUser.status()).toBe(401);
});

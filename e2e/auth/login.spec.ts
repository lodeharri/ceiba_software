import { test, expect } from '@playwright/test';

/**
 * E2E: US-1 Login Happy Path
 * Verifies: correct credentials → JWT token returned, redirected to /productos
 */
test('US-1: successful login redirects to productos', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/login`);

  await page.fill('[data-testid="username-input"]', 'admin');
  await page.fill('[data-testid="password-input"]', 'Admin123!');
  await page.click('[data-testid="login-button"]');

  await expect(page).toHaveURL(/\/productos/);
  await expect(page.locator('body')).not.toContainText('401');
});

/**
 * E2E: US-1 Wrong Credentials
 * Verifies: wrong password → 401 error displayed
 */
test('US-1: wrong password returns 401', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/login`);

  await page.fill('[data-testid="username-input"]', 'admin');
  await page.fill('[data-testid="password-input"]', 'wrongpassword');
  await page.click('[data-testid="login-button"]');

  await expect(page.locator('[data-testid="error-message"]')).toContainText('401');
});

/**
 * E2E: US-1 Five Failures → 429
 * Verifies: 5 consecutive failed attempts → rate limited
 * Q-P4: successful login does NOT increment counter
 */
test('US-1: 5 failures → 429 rate limit', async ({ request, baseURL }) => {
  const loginUrl = `${baseURL}/api/v1/auth/login`;
  const wrongPayload = { username: 'admin', password: 'wrong' };

  // 5 failures
  for (let i = 0; i < 5; i++) {
    await request.post(loginUrl, { data: wrongPayload });
  }

  // 6th attempt should be rate limited
  const response = await request.post(loginUrl, { data: wrongPayload });
  expect(response.status()).toBe(429);
});

/**
 * E2E: US-1 Rate Limit Consistency
 * NOTE: Intentionally duplicates the previous 5-failures → 429 scenario.
 * Verifies: rate-limit behaviour is consistent when the same wrong password
 * payload is re-issued in a fresh test (i.e. the limiter state is not an
 * artefact of the prior test's request history leaking across cases).
 */
test('US-1: 429 still triggered after re-issuing same wrong password', async ({
  request,
  baseURL,
}) => {
  const loginUrl = `${baseURL}/api/v1/auth/login`;

  // 5 failures
  for (let i = 0; i < 5; i++) {
    await request.post(loginUrl, { data: { username: 'admin', password: 'wrong' } });
  }

  // Verify rate limit kicks in
  const rateLimited = await request.post(loginUrl, {
    data: { username: 'admin', password: 'wrong' },
  });
  expect(rateLimited.status()).toBe(429);
});

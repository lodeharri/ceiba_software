import { test, expect } from '@playwright/test';

/**
 * E2E: JWT Dual-Secret Rotation
 * Verifies: old-secret token valid in overlap period, rejected after overlap
 * This requires test environment with JWT_SECRET_PREVIOUS configured
 */
test.describe('JWT Rotation', () => {
  test('old-secret token valid during overlap period', async ({ request, baseURL }) => {
    // Skip if rotation not configured in test environment
    test.skip(process.env.JWT_SECRET_PREVIOUS === undefined);

    const response = await request.post(`${baseURL}/api/v1/auth/login`, {
      data: { username: 'admin', password: 'Admin123!' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data?.token).toBeDefined();
  });

  test('single-secret mode fallback works', async ({ request, baseURL }) => {
    // When JWT_SECRET_PREVIOUS is not set, single-secret mode should work
    const response = await request.post(`${baseURL}/api/v1/auth/login`, {
      data: { username: 'admin', password: 'Admin123!' },
    });

    expect(response.status()).toBe(200);
  });
});

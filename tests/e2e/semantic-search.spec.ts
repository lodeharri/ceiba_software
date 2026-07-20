import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

test('POST /api/v1/products/semantic-search returns 200 with items[]', async ({ request }) => {
  const token = process.env.E2E_JWT ?? 'placeholder-jwt';
  const response = await request.post(`${BASE_URL}/api/v1/products/semantic-search`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { q: 'laptop gaming', limit: 10 },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(typeof body.total).toBe('number');
});

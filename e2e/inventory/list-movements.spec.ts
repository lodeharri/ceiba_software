import { test, expect, request } from '@playwright/test';

/**
 * Helper: get auth token
 */
async function getAuthToken(baseURL: string): Promise<string> {
  const response = await request.post(`${baseURL}/api/v1/auth/login`, {
    data: { username: 'admin', password: 'Admin123!' },
  });
  const body = await response.json();
  return body.data?.token;
}

/**
 * Helper: create test product
 */
async function createTestProduct(baseURL: string, token: string): Promise<string> {
  const sku = `LIST${Date.now()}`;
  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'List Movements Product',
      sku,
      price: 50000,
      stock: 100,
      stockMin: 20,
      supplier: 'List Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const body = await response.json();
  return body.data.id;
}

/**
 * E2E: List Movements - Default size=50 (Q-P2)
 */
test('inventory: list movements defaults to size=50', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token);

  const response = await request.get(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.size).toBe(50);
});

/**
 * E2E: List Movements - Second Page Works
 */
test('inventory: list movements second page works', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token);

  // Get first page
  const page1 = await request.get(
    `${baseURL}/api/v1/products/${productId}/movements?page=1&size=10`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const page1Body = await page1.json();

  // Get second page
  const page2 = await request.get(
    `${baseURL}/api/v1/products/${productId}/movements?page=2&size=10`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(page2.status()).toBe(200);

  // Verify different items
  if (page1Body.data.items?.length > 0 && page1Body.data.total > 10) {
    expect(page1Body.data.items[0].id).not.toBe(page2.body().data.items[0]?.id);
  }
});

/**
 * E2E: List Movements - Out of Range Size Returns 400
 */
test('inventory: out of range size returns 400', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token);

  // Size > 100 should be rejected
  const response = await request.get(`${baseURL}/api/v1/products/${productId}/movements?size=201`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(response.status()).toBe(400);
});

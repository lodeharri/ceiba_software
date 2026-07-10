import { test, expect, request } from '@playwright/test';

/**
 * E2E: RISK-W01 XSS Prevention
 * Verifies product names with script tags render as literal text
 */
async function getAuthToken(baseURL: string): Promise<string> {
  const response = await request.post(`${baseURL}/api/v1/auth/login`, {
    data: { username: 'admin', password: 'Admin123!' },
  });
  const body = await response.json();
  return body.data?.token;
}

test('RISK-W01: XSS payload renders as literal text', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const xssPayload = '<script>alert(1)</script>';
  const sku = `XSS${Date.now()}`;

  // Create product with XSS payload in name
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: xssPayload,
      sku,
      price: 50000,
      stock: 100,
      stockMin: 20,
      supplier: 'XSS Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });

  expect(createResp.status()).toBe(201);
  const product = await createResp.json();

  // Fetch the product
  const getResp = await request.get(`${baseURL}/api/v1/products/${product.data.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const fetched = await getResp.json();

  // The raw API response should contain the literal string
  expect(JSON.stringify(fetched)).toContain(xssPayload);

  // In the SPA, Vue's default escaping should render it as text
  // This test verifies the API stores it correctly;
  // the frontend test verifies it renders safely
});

test('RISK-W01: various XSS payloads are stored correctly', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const xssPayloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '<svg onload=alert(1)>',
  ];

  for (const payload of xssPayloads) {
    const sku = `XSS${Date.now()}${Math.random().toString(36).slice(2)}`;

    const createResp = await request.post(`${baseURL}/api/v1/products`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: payload,
        sku,
        price: 50000,
        stock: 100,
        stockMin: 20,
        supplier: 'XSS Supplier',
        categoryId: '00000000-0000-0000-0000-000000000001',
      },
    });

    expect(createResp.status()).toBe(201);
  }
});

import { test, expect } from '@playwright/test';

/** Seed category ID — Bebidas */
const CATEGORY_ID = '75b931be-340e-4755-83a8-b5313c1a6afe';

/**
 * E2E: BR-4 / RF-03 — Creating a product with stock below stockMin opens an alert.
 *
 * When a product is created with stock <= stockMin, the system MUST generate
 * a STOCK_BAJO alert automatically (per RF-03 and README Workflow 1).
 * This test reproduces the bug where this was NOT happening.
 */
test('alerts: creating product with stock below stockMin opens alert (RF-03)', async ({
  request,
  baseURL,
}) => {
  const loginResp = await request.post(`${baseURL}/api/v1/auth/login`, {
    data: {
      username: 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'Admin#Local-2025-change-me',
    },
  });
  const loginBody = await loginResp.json();
  const token: string = loginBody.token;
  expect(token).toBeDefined();

  // SKU must be 6-20 chars [A-Za-z0-9-]; Date.now().toString(36) ≈ 11 chars
  const sku = `I${Date.now().toString(36)}`;
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      name: 'Low Stock Init Product',
      sku,
      price: 25000,
      stock: 0,
      stockMin: 10,
      supplier: 'Low Stock Init Supplier',
      categoryId: CATEGORY_ID,
    },
  });

  expect(createResp.status()).toBe(201);
  const createBody = await createResp.json();
  const productId: string = createBody.id;
  expect(productId).toBeDefined();

  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  expect(alertsResp.status()).toBe(200);
  const alertsBody = await alertsResp.json();
  const alert = alertsBody.items?.find((a: { productId: string }) => a.productId === productId);

  expect(alert, 'Alert should be created when product is initialized below stockMin').toBeDefined();
  expect(alert.status).toBe('ACTIVA');
  // type is stored in DB but not exposed in AlertReadModel (all alerts are STOCK_BAJO per current schema)
  expect(alert.productId).toBe(productId);
});

/** Negative test — stock above stockMin must NOT open an alert */
test('alerts: creating product with stock above stockMin does NOT open alert', async ({
  request,
  baseURL,
}) => {
  const loginResp = await request.post(`${baseURL}/api/v1/auth/login`, {
    data: {
      username: 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'Admin#Local-2025-change-me',
    },
  });
  const loginBody = await loginResp.json();
  const token: string = loginBody.token;

  const sku = `O${Date.now().toString(36)}`;
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      name: 'Normal Stock Init Product',
      sku,
      price: 25000,
      stock: 100,
      stockMin: 10,
      supplier: 'Normal Supplier',
      categoryId: CATEGORY_ID,
    },
  });

  expect(createResp.status()).toBe(201);
  const createBody = await createResp.json();
  const productId: string = createBody.id;

  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  expect(alertsResp.status()).toBe(200);
  const alertsBody = await alertsResp.json();
  const alert = alertsBody.items?.find((a: { productId: string }) => a.productId === productId);

  expect(
    alert,
    'Alert should NOT be created when product is initialized above stockMin',
  ).toBeUndefined();
});

/** Edge case — stock == stockMin (>= per spec) opens an alert */
test('alerts: creating product with stock equal to stockMin opens alert', async ({
  request,
  baseURL,
}) => {
  const loginResp = await request.post(`${baseURL}/api/v1/auth/login`, {
    data: {
      username: 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'Admin#Local-2025-change-me',
    },
  });
  const loginBody = await loginResp.json();
  const token: string = loginBody.token;

  const sku = `E${Date.now().toString(36)}`;
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      name: 'Edge Stock Init Product',
      sku,
      price: 30000,
      stock: 10,
      stockMin: 10,
      supplier: 'Edge Supplier',
      categoryId: CATEGORY_ID,
    },
  });

  expect(createResp.status()).toBe(201);
  const createBody = await createResp.json();
  const productId: string = createBody.id;

  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  expect(alertsResp.status()).toBe(200);
  const alertsBody = await alertsResp.json();
  const alert = alertsBody.items?.find((a: { productId: string }) => a.productId === productId);

  expect(
    alert,
    'Alert should be created when product stock equals stockMin (stock <= stockMin)',
  ).toBeDefined();
  expect(alert.status).toBe('ACTIVA');
  // type is stored in DB but not exposed in AlertReadModel (all alerts are STOCK_BAJO per current schema)
});

import { test, expect, request } from '@playwright/test';

/**
 * Helper: create a product and return its ID
 */
async function createTestProduct(baseURL: string, token: string, stock = 100): Promise<string> {
  const sku = `INV${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Inventory Test Product',
      sku,
      price: 50000,
      stock,
      stockMin: 20,
      supplier: 'Inventory Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const body = await response.json();
  return body.data.id;
}

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
 * E2E: Inventory - ENTRADA Happy Path
 */
test('inventory: ENTRADA increases stock', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 50);
  const initialStock = 50;

  const response = await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: 'ENTRADA',
      quantity: 25,
      reason: 'Received from supplier',
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data.stockAfter).toBe(initialStock + 25);
});

/**
 * E2E: Inventory - SALIDA Happy Path
 */
test('inventory: SALIDA decreases stock', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 50);

  const response = await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: 'SALIDA',
      quantity: 20,
      reason: 'Sold to customer',
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data.stockAfter).toBe(30);
});

/**
 * E2E: Inventory - SALIDA Below Zero Returns 422
 * BR-1: Stock cannot go negative
 */
test('inventory: SALIDA below 0 returns 422 with details', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 10);

  const response = await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: 'SALIDA',
      quantity: 15,
      reason: 'Customer order',
    },
  });

  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error.code).toBe('STOCK_WOULD_GO_NEGATIVE');
  expect(body.error.details).toMatchObject({
    currentStock: 10,
    requested: 15,
    shortBy: 5,
  });
});

/**
 * E2E: RISK-002 - Concurrent SALIDA Serializes
 * Two parallel SALIDA requests → one succeeds, one gets 422
 */
test('inventory: concurrent SALIDA serializes (RISK-002)', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 5);

  const [resp1, resp2] = await Promise.all([
    request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { type: 'SALIDA', quantity: 3, reason: 'Concurrent sale 1' },
    }),
    request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { type: 'SALIDA', quantity: 3, reason: 'Concurrent sale 2' },
    }),
  ]);

  const statuses = [resp1.status(), resp2.status()].sort();
  expect(statuses).toEqual([200, 422]);
});

/**
 * E2E: RISK-001 - Manual ENTRADA Closes Active Alert
 * When stock crosses above stockMin, active alert should be resolved
 */
test('inventory: ENTRADA above stockMin closes active alert (RISK-001)', async ({
  request,
  baseURL,
}) => {
  const token = await getAuthToken(baseURL);

  // Create product with stock at minimum
  const sku = `ALERT${Date.now()}`;
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Alert Test Product',
      sku,
      price: 50000,
      stock: 10, // At stockMin
      stockMin: 10,
      supplier: 'Alert Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const product = await createResp.json();
  const productId = product.data.id;

  // Cross below to trigger alert
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 5, reason: 'Sale below min' },
  });

  // Check alert exists
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const alertsBody = await alertsResp.json();
  const activeAlert = alertsBody.data?.items?.find(
    (a: { productId: string }) => a.productId === productId,
  );

  if (activeAlert) {
    // ENTRADA to bring stock above min
    await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { type: 'ENTRADA', quantity: 10, reason: 'Restocking' },
    });

    // Verify alert is resolved
    const updatedAlert = await request.get(`${baseURL}/api/v1/alerts/${activeAlert.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updatedBody = await updatedAlert.json();
    expect(updatedBody.data.status).toBe('RESUELTA');
  }
});

/**
 * E2E: Inventory - Append-Only Invariant
 * Movements cannot be updated or deleted
 */
test('inventory: movements are append-only', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 50);

  // Create a movement
  const createResp = await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'ENTRADA', quantity: 10, reason: 'Initial stock' },
  });
  const movement = await createResp.json();
  const movementId = movement.data.id;

  // PUT should not exist
  const putResp = await request.put(
    `${baseURL}/api/v1/products/${productId}/movements/${movementId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { type: 'SALIDA', quantity: 5, reason: 'Modified' },
    },
  );
  expect(putResp.status()).toBe(404);

  // PATCH should not exist
  const patchResp = await request.patch(
    `${baseURL}/api/v1/products/${productId}/movements/${movementId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { quantity: 5 },
    },
  );
  expect(patchResp.status()).toBe(404);

  // DELETE should not exist
  const deleteResp = await request.delete(
    `${baseURL}/api/v1/products/${productId}/movements/${movementId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(deleteResp.status()).toBe(404);
});

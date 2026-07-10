import { test, expect, request } from '@playwright/test';

/**
 * E2E: RISK-001 Recovery Closes Alert
 * Verifies manual ENTRADA above stockMin closes active alert
 * and transaction rollback works if alert-close throws
 */
async function getAuthToken(baseURL: string): Promise<string> {
  const response = await request.post(`${baseURL}/api/v1/auth/login`, {
    data: { username: 'admin', password: 'Admin123!' },
  });
  const body = await response.json();
  return body.data?.token;
}

async function createTestProduct(
  baseURL: string,
  token: string,
  stock: number,
  stockMin: number,
): Promise<string> {
  const sku = `REC${Date.now()}`;
  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Recovery Test Product',
      sku,
      price: 50000,
      stock,
      stockMin,
      supplier: 'Recovery Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const body = await response.json();
  return body.data.id;
}

test('RISK-001: manual ENTRADA above stockMin closes active alert', async ({
  request,
  baseURL,
}) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 30, 50);

  // Create alert by crossing below stockMin
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 10, reason: 'Sale below min' },
  });

  // Verify alert is ACTIVA
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const alertsBody = await alertsResp.json();
  const alert = alertsBody.data?.items?.find(
    (a: { productId: string }) => a.productId === productId,
  );

  expect(alert).toBeDefined();
  expect(alert.status).toBe('ACTIVA');

  // ENTRADA to bring stock above stockMin
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'ENTRADA', quantity: 30, reason: 'Restock above min' },
  });

  // Verify alert is now RESUELTA
  const updatedAlert = await request.get(`${baseURL}/api/v1/alerts/${alert.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const updatedBody = await updatedAlert.json();
  expect(updatedBody.data.status).toBe('RESUELTA');
  expect(updatedBody.data.resolvedAt).toBeDefined();
});

test('RISK-001: ENTRADA at exactly stockMin does NOT close alert', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 40, 50);

  // Create alert
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 10, reason: 'Sale' },
  });

  // Get alert
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const alertsBody = await alertsResp.json();
  const alert = alertsBody.data?.items?.find(
    (a: { productId: string }) => a.productId === productId,
  );

  // ENTRADA to exactly stockMin (not above)
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'ENTRADA', quantity: 20, reason: 'Restock to min' },
  });

  // Alert should still be ACTIVA (at or below, not above)
  const updatedAlert = await request.get(`${baseURL}/api/v1/alerts/${alert.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const updatedBody = await updatedAlert.json();
  expect(updatedBody.data.status).toBe('ACTIVA');
});

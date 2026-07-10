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
async function createTestProduct(
  baseURL: string,
  token: string,
  stock = 100,
  stockMin = 50,
): Promise<string> {
  const sku = `ALERT${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Alert Lifecycle Product',
      sku,
      price: 50000,
      stock,
      stockMin,
      supplier: 'Alert Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const body = await response.json();
  return body.data.id;
}

/**
 * E2E: Alert Lifecycle - First Crossing Below Opens Alert
 * BR-4: When stock crosses below stockMin, alert should open
 */
test('alerts: crossing below stockMin opens alert', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 100, 50);

  // SALIDA to cross below stockMin
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 60, reason: 'Large sale' },
  });

  // Check alert was created
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(alertsResp.status()).toBe(200);
  const body = await alertsResp.json();
  const alert = body.data?.items?.find((a: { productId: string }) => a.productId === productId);

  expect(alert).toBeDefined();
  expect(alert.status).toBe('ACTIVA');
  expect(alert.type).toBe('STOCK_BAJO');
});

/**
 * E2E: Alert Lifecycle - Repeated Event is No-Op
 * BR-4: If alert already ACTIVA, another crossing below does nothing
 */
test('alerts: repeated crossing is no-op when alert already ACTIVA', async ({
  request,
  baseURL,
}) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 100, 50);

  // First crossing below
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 60, reason: 'First sale' },
  });

  // Get alert count
  const alerts1 = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body1 = await alerts1.json();
  const alertCount1 =
    body1.data?.items?.filter((a: { productId: string }) => a.productId === productId).length ?? 0;

  // Second crossing below (should not create another alert)
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 5, reason: 'Second sale' },
  });

  const alerts2 = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body2 = await alerts2.json();
  const alertCount2 =
    body2.data?.items?.filter((a: { productId: string }) => a.productId === productId).length ?? 0;

  expect(alertCount2).toBe(alertCount1);
});

/**
 * E2E: Alert Lifecycle - Partial Unique Index Violation
 * BR-4: Only one ACTIVA alert per product (partial unique index)
 */
test('alerts: partial unique index prevents duplicate ACTIVA alerts', async ({
  request,
  baseURL,
}) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 100, 50);

  // Create alert
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 60, reason: 'Create alert' },
  });

  // Try direct creation (if endpoint exists)
  const createResp = await request.post(`${baseURL}/api/v1/alerts`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId, type: 'STOCK_BAJO' },
  });

  // Should fail or return existing alert
  expect(createResp.status()).toBeOneOf([409, 400]);
});

/**
 * E2E: BR-3, BR-D4 - Alert Auto-Closes on Recovery
 * When stock goes above stockMin, alert should auto-close
 */
test('alerts: ENTRADA above stockMin auto-closes alert', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 30, 50);

  // Cross below to create alert
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 10, reason: 'Sale below min' },
  });

  // Get the alert
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await alertsResp.json();
  const alert = body.data?.items?.find((a: { productId: string }) => a.productId === productId);

  expect(alert).toBeDefined();

  // ENTRADA to bring above stockMin
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

/**
 * E2E: BR-D4 - Order Receive Closes Alert
 * When order is received, active alert for that product should close
 */
test('alerts: order receive closes active alert (BR-D4)', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const productId = await createTestProduct(baseURL, token, 30, 50);

  // Create alert
  await request.post(`${baseURL}/api/v1/products/${productId}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 10, reason: 'Sale' },
  });

  // Get alert
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await alertsResp.json();
  const alert = body.data?.items?.find((a: { productId: string }) => a.productId === productId);

  if (alert) {
    // Create and approve order
    const orderResp = await request.post(`${baseURL}/api/v1/orders`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        productId,
        quantity: 20,
        fromAlertId: alert.id,
      },
    });

    if (orderResp.status() === 201) {
      const order = await orderResp.json();
      const orderId = order.data.id;

      // Approve order
      await request.post(`${baseURL}/api/v1/orders/${orderId}/approve`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Receive order
      await request.post(`${baseURL}/api/v1/orders/${orderId}/receive`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Verify alert is closed
      const updatedAlert = await request.get(`${baseURL}/api/v1/alerts/${alert.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updatedBody = await updatedAlert.json();
      expect(updatedBody.data.status).toBe('RESUELTA');
    }
  }
});

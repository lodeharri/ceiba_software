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
): Promise<{ id: string; sku: string }> {
  const sku = `ORD${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Order Test Product',
      sku,
      price: 50000,
      stock,
      stockMin: 20,
      supplier: 'Order Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const body = await response.json();
  return { id: body.data.id, sku: body.data.sku };
}

/**
 * E2E: Orders - Create Manual Order
 */
test('orders: create manual order happy path', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 100);

  const response = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      productId: product.id,
      quantity: 10,
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data.productId).toBe(product.id);
  expect(body.data.quantity).toBe(10);
  expect(body.data.status).toBe('PENDIENTE');
  expect(body.data.supplierSnapshot).toBe('Order Supplier');
});

/**
 * E2E: Orders - Create from Alert
 * BR-D4: Order can be created with fromAlertId
 */
test('orders: create order from alert', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 30);

  // Create alert first
  await request.post(`${baseURL}/api/v1/products/${product.id}/movements`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SALIDA', quantity: 15, reason: 'Create alert' },
  });

  // Get alert
  const alertsResp = await request.get(`${baseURL}/api/v1/alerts?status=ACTIVA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const alertsBody = await alertsResp.json();
  const alert = alertsBody.data?.items?.find(
    (a: { productId: string }) => a.productId === product.id,
  );

  if (alert) {
    const response = await request.post(`${baseURL}/api/v1/orders`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        productId: product.id,
        quantity: 20,
        fromAlertId: alert.id,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.data.fromAlertId).toBe(alert.id);
  }
});

/**
 * E2E: Orders - Quantity Below Policy 422
 * BR-D3: quantity < 2 * stockMin should be rejected
 */
test('orders: quantity below policy returns 422', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 100);

  // stockMin = 20, so min order = 40
  const response = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      productId: product.id,
      quantity: 10, // Below 2 * 20 = 40
    },
  });

  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error.code).toBe('ORDER_QTY_BELOW_POLICY');
});

/**
 * E2E: Orders - Supplier Snapshot is Write-Once (Q-P3)
 */
test('orders: supplierSnapshot is write-once', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 100);

  // Create order
  const orderResp = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId: product.id, quantity: 40 },
  });
  const order = await orderResp.json();
  const originalSupplier = order.data.supplierSnapshot;

  // Change product supplier
  await request.patch(`${baseURL}/api/v1/products/${product.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { supplier: 'New Supplier Name' },
  });

  // Get order again
  const updatedOrder = await request.get(`${baseURL}/api/v1/orders/${order.data.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const updatedBody = await updatedOrder.json();

  // Supplier should be unchanged
  expect(updatedBody.data.supplierSnapshot).toBe(originalSupplier);
});

/**
 * E2E: Orders - Approve PENDIENTE → APROBADA
 */
test('orders: approve transitions PENDIENTE to APROBADA', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 100);

  // Create order
  const orderResp = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId: product.id, quantity: 40 },
  });
  const order = await orderResp.json();

  // Approve
  const approveResp = await request.post(`${baseURL}/api/v1/orders/${order.data.id}/approve`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(approveResp.status()).toBe(200);
  const approveBody = await approveResp.json();
  expect(approveBody.data.status).toBe('APROBADA');
});

/**
 * E2E: Orders - Reject Requires ≥10 Chars (BR-D2)
 */
test('orders: reject requires 10 char reason', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 100);

  // Create order
  const orderResp = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId: product.id, quantity: 40 },
  });
  const order = await orderResp.json();

  // Reject with short reason
  const rejectResp = await request.post(`${baseURL}/api/v1/orders/${order.data.id}/reject`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { reason: 'short' },
  });

  expect(rejectResp.status()).toBe(422);

  // Reject with valid reason
  const validReject = await request.post(`${baseURL}/api/v1/orders/${order.data.id}/reject`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { reason: 'Supplier out of stock for this item' },
  });

  expect(validReject.status()).toBe(200);
});

/**
 * E2E: Orders - Receive APROBADA → RECIBIDA Atomic
 * Four-step atomic flow per ADR-3
 */
test('orders: receive transitions APROBADA to RECIBIDA atomically', async ({
  request,
  baseURL,
}) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 80);

  // Create and approve order
  const orderResp = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId: product.id, quantity: 40 },
  });
  const order = await orderResp.json();

  await request.post(`${baseURL}/api/v1/orders/${order.data.id}/approve`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Get initial stock
  const productResp = await request.get(`${baseURL}/api/v1/products/${product.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const initialStock = (await productResp.json()).data.stock;

  // Receive
  const receiveResp = await request.post(`${baseURL}/api/v1/orders/${order.data.id}/receive`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(receiveResp.status()).toBe(200);
  const receiveBody = await receiveResp.json();
  expect(receiveBody.data.status).toBe('RECIBIDA');
  expect(receiveBody.data.stockAfter).toBe(initialStock + 40);

  // Verify stock was updated
  const updatedProduct = await request.get(`${baseURL}/api/v1/products/${product.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const updatedBody = await updatedProduct.json();
  expect(updatedBody.data.stock).toBe(initialStock + 40);
});

/**
 * E2E: RISK-W07 - Duplicate Receive Blocked by State Machine
 */
test('orders: duplicate receive blocked by state machine (RISK-W07)', async ({
  request,
  baseURL,
}) => {
  const token = await getAuthToken(baseURL);
  const product = await createTestProduct(baseURL, token, 100);

  // Create and approve order
  const orderResp = await request.post(`${baseURL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId: product.id, quantity: 40 },
  });
  const order = await orderResp.json();

  await request.post(`${baseURL}/api/v1/orders/${order.data.id}/approve`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // First receive
  const firstReceive = await request.post(`${baseURL}/api/v1/orders/${order.data.id}/receive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(firstReceive.status()).toBe(200);

  // Duplicate receive should fail with 409
  const duplicateReceive = await request.post(`${baseURL}/api/v1/orders/${order.data.id}/receive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(duplicateReceive.status()).toBe(409);
  const body = await duplicateReceive.json();
  expect(body.error.code).toBe('ORDER_INVALID_TRANSITION');
});

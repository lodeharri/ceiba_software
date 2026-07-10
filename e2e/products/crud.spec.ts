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
 * E2E: Products CRUD - Create Happy Path
 */
test('products: create happy path', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const sku = `TEST${Date.now()}`;

  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Test Product',
      sku,
      price: 50000,
      stock: 10,
      stockMin: 5,
      supplier: 'Test Supplier Inc.',
      categoryId: '00000000-0000-0000-0000-000000000001', // seed category
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data.sku).toBe(sku);
});

/**
 * E2E: Products CRUD - Duplicate SKU 409
 */
test('products: duplicate SKU returns 409', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const sku = `DUP${Date.now()}`;

  // Create first product
  await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'First Product',
      sku,
      price: 50000,
      stock: 10,
      stockMin: 5,
      supplier: 'Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });

  // Try duplicate SKU
  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Second Product',
      sku,
      price: 60000,
      stock: 20,
      stockMin: 10,
      supplier: 'Supplier 2',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });

  expect(response.status()).toBe(409);
  const body = await response.json();
  expect(body.error.code).toBe('SKU_ALREADY_EXISTS');
});

/**
 * E2E: Products CRUD - SKU Race Condition
 * Two concurrent creates with same SKU → one 201, one 409
 */
test('products: SKU race - one 201, one 409', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const sku = `RACE${Date.now()}`;
  const productData = {
    name: 'Racing Product',
    sku,
    price: 75000,
    stock: 15,
    stockMin: 5,
    supplier: 'Race Supplier',
    categoryId: '00000000-0000-0000-0000-000000000001',
  };

  // Fire two concurrent requests
  const [resp1, resp2] = await Promise.all([
    request.post(`${baseURL}/api/v1/products`, {
      headers: { Authorization: `Bearer ${token}` },
      data: productData,
    }),
    request.post(`${baseURL}/api/v1/products`, {
      headers: { Authorization: `Bearer ${token}` },
      data: productData,
    }),
  ]);

  const statuses = [resp1.status(), resp2.status()].sort();
  expect(statuses).toEqual([201, 409]);
});

/**
 * E2E: RISK-S02 - PATCH with same body returns same product (idempotent)
 */
test('products: PATCH with same body is idempotent', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const sku = `IDEM${Date.now()}`;

  // Create product
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Idempotent Product',
      sku,
      price: 100000,
      stock: 50,
      stockMin: 10,
      supplier: 'Idem Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const product = await createResp.json();
  const productId = product.data.id;

  // First PATCH
  const patch1 = await request.patch(`${baseURL}/api/v1/products/${productId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Updated Name' },
  });
  const result1 = await patch1.json();

  // Second PATCH with same data
  const patch2 = await request.patch(`${baseURL}/api/v1/products/${productId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Updated Name' },
  });
  const result2 = await patch2.json();

  expect(patch1.status()).toBe(200);
  expect(patch2.status()).toBe(200);
  expect(result1.data.name).toBe(result2.data.name);
});

/**
 * E2E: Products CRUD - Bad CategoryId 422
 */
test('products: invalid categoryId returns 422', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);

  const response = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Bad Category Product',
      sku: `BADCAT${Date.now()}`,
      price: 50000,
      stock: 10,
      stockMin: 5,
      supplier: 'Supplier',
      categoryId: 'not-a-uuid',
    },
  });

  expect(response.status()).toBe(422);
});

/**
 * E2E: Products CRUD - PATCH rejects forbidden fields
 */
test('products: PATCH rejects sku/stock/id fields', async ({ request, baseURL }) => {
  const token = await getAuthToken(baseURL);
  const sku = `PATCH${Date.now()}`;

  // Create product
  const createResp = await request.post(`${baseURL}/api/v1/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Patch Test',
      sku,
      price: 50000,
      stock: 10,
      stockMin: 5,
      supplier: 'Supplier',
      categoryId: '00000000-0000-0000-0000-000000000001',
    },
  });
  const product = await createResp.json();
  const productId = product.data.id;

  // Try to patch forbidden fields
  for (const forbidden of ['sku', 'stock', 'id']) {
    const response = await request.patch(`${baseURL}/api/v1/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { [forbidden]: forbidden === 'id' ? 'xxx' : 'xxx' },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  }
});

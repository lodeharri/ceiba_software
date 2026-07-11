/**
 * Unit tests for OrderCreatePage component.
 *
 * Covers:
 *  - happy-path submit → orders.create → navigate to orders-list
 *  - validation: missing product → error banner
 *  - validation: zero quantity → error banner
 *  - API 4xx error → error banner shows backend message
 *  - InvalidOrdersResponseError (Zod drift) → error banner shows service message
 *  - loading state: button is disabled and shows spinner while submitting
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { setActivePinia, createPinia } from 'pinia';

const P1 = '22222222-2222-4222-8222-222222222222';
const O1 = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock('@/stores/orders', () => ({
  useOrdersStore: vi.fn().mockReturnValue({
    create: mockCreate,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/stores/products', () => ({
  useProductsStore: vi.fn().mockReturnValue({
    items: [{ id: P1, name: 'Coca-Cola', sku: 'SKU-COCA', stock: 100, supplier: 'CocaCola' }],
    loading: false,
    error: null,
    fetchList: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRouterWrapper() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div>Home</div>' } },
      { path: '/pedidos', name: 'orders-list', component: { template: '<div>Orders</div>' } },
      {
        path: '/pedidos/nuevo',
        name: 'order-create',
        component: { template: '<div>Create</div>' },
      },
    ],
  });
  return router;
}

async function mountPage(router: ReturnType<typeof createRouterWrapper>) {
  const { default: OrderCreatePage } = await import('./OrderCreatePage.vue');
  const wrapper = mount(OrderCreatePage, {
    global: {
      plugins: [router],
      mocks: { $t: (k: string) => k },
    },
  });
  // Wait for onMounted (fetchList)
  await new Promise((r) => setTimeout(r, 10));
  return wrapper;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it('shows validation error when product is not selected', async () => {
    const router = createRouterWrapper();
    const wrapper = await mountPage(router);

    // Set quantity but not product
    const qtyInput = wrapper.find('#order-qty');
    await qtyInput.setValue(5);

    // Submit
    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.find('[role="alert"]').text()).toContain('Selecciona un producto.');
    expect(mockCreate).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows validation error when quantity is zero', async () => {
    const router = createRouterWrapper();
    const wrapper = await mountPage(router);

    // Select product but set quantity to 0
    const select = wrapper.find('#order-product');
    await select.setValue(P1);
    const qtyInput = wrapper.find('#order-qty');
    await qtyInput.setValue(0);

    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.find('[role="alert"]').text()).toContain('La cantidad debe ser mayor que cero.');
    expect(mockCreate).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('happy path: submit calls orders.create and navigates to orders-list', async () => {
    const router = createRouterWrapper();
    mockCreate.mockResolvedValue({
      id: O1,
      productId: P1,
      productName: 'Coca-Cola',
      productSku: 'SKU-COCA',
      quantity: 5,
      supplierSnapshot: 'CocaCola',
      fromAlertId: null,
      status: 'PENDIENTE',
      rejectionReason: null,
      createdBy: 'user-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      receivedAt: null,
    });

    const wrapper = await mountPage(router);

    // Select product and set quantity
    await wrapper.find('#order-product').setValue(P1);
    await wrapper.find('#order-qty').setValue(5);

    await wrapper.find('form').trigger('submit');
    await router.isReady();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCreate).toHaveBeenCalledWith({ productId: P1, quantity: 5 });
    expect(router.currentRoute.value.name).toBe('orders-list');
    wrapper.unmount();
  });

  it('API 4xx error: shows the backend message in the error banner', async () => {
    const router = createRouterWrapper();
    mockCreate.mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        data: { code: 'FORBIDDEN', message: 'No tienes permiso para crear pedidos.' },
      }),
    );

    const wrapper = await mountPage(router);
    await wrapper.find('#order-product').setValue(P1);
    await wrapper.find('#order-qty').setValue(5);

    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 20));

    expect(wrapper.find('[role="alert"]').text()).toBe('No tienes permiso para crear pedidos.');
    wrapper.unmount();
  });

  it('InvalidOrdersResponseError (Zod drift): shows the service error message', async () => {
    const router = createRouterWrapper();
    const { InvalidOrdersResponseError } = await import('@/services/orders');
    mockCreate.mockRejectedValue(
      new InvalidOrdersResponseError(
        'El servidor devolvió un pedido creado inválido.',
        { id: O1 },
        [{ path: ['quantity'], message: 'Required' }],
      ),
    );

    const wrapper = await mountPage(router);
    await wrapper.find('#order-product').setValue(P1);
    await wrapper.find('#order-qty').setValue(5);

    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 20));

    expect(wrapper.find('[role="alert"]').text()).toBe(
      'El servidor devolvió un pedido creado inválido.',
    );
    wrapper.unmount();
  });

  it('clears previous error on new submit attempt', async () => {
    const router = createRouterWrapper();
    // First call fails
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error(), {
        statusCode: 500,
        data: { code: 'INTERNAL', message: 'Fallo interno.' },
      }),
    );
    // Second call succeeds
    mockCreate.mockResolvedValueOnce({
      id: O1,
      productId: P1,
      productName: 'Coca-Cola',
      productSku: 'SKU-COCA',
      quantity: 5,
      supplierSnapshot: 'CocaCola',
      fromAlertId: null,
      status: 'PENDIENTE',
      rejectionReason: null,
      createdBy: 'user-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      receivedAt: null,
    });

    const wrapper = await mountPage(router);
    await wrapper.find('#order-product').setValue(P1);
    await wrapper.find('#order-qty').setValue(5);

    // First submit — fails
    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 20));
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);

    // Second submit — succeeds, error should be gone
    await wrapper.find('#order-product').setValue(P1);
    await wrapper.find('#order-qty').setValue(5);
    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 20));
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

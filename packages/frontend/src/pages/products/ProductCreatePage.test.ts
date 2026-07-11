/**
 * Unit tests for ProductCreatePage component.
 * Verifies form validation, submission with stock field, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/stores/products', () => ({
  useProductsStore: vi.fn().mockReturnValue({
    create: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock('@/stores/categories', () => ({
  useCategoriesStore: vi.fn().mockReturnValue({
    items: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Bebidas' }],
    fetchList: vi.fn().mockResolvedValue(undefined),
  }),
}));

import ProductCreatePage from './ProductCreatePage.vue';
import type { Product } from '@/services/products';

function createWrapper() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div>Home</div>' } },
      { path: '/products', name: 'products-list', component: { template: '<div>List</div>' } },
    ],
  });

  return mount(ProductCreatePage, {
    global: {
      plugins: [router],
      mocks: { $t: (k: string) => k },
    },
  });
}

describe('ProductCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it('shows validation errors for required fields on empty submit', async () => {
    const wrapper = createWrapper();
    await wrapper.find('form').trigger('submit.prevent');

    // SKU validation first checks min length (6 chars)
    expect(wrapper.find('#field-sku-error').text()).toContain('6 caracteres');
    expect(wrapper.find('#field-name-error').text()).toContain('obligatorio');
  });

  it('submits with stock field included', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockStore = useProductsStore();
    mockStore.create.mockResolvedValueOnce({ id: 'p-1' } as Product);

    const wrapper = createWrapper();

    // Fill required fields using the input elements
    await wrapper.find('#field-sku').setValue('SKU-001');
    await wrapper.find('#field-name').setValue('Test Product');
    await wrapper.find('#field-price').setValue(1500);
    await wrapper.find('#field-stock').setValue(10);
    await wrapper.find('#field-stockMin').setValue(5);
    await wrapper.find('#field-supplier').setValue('Test Supplier');
    await wrapper.find('#create-category').setValue('22222222-2222-4222-8222-222222222222');

    await wrapper.find('form').trigger('submit.prevent');

    expect(mockStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'SKU-001',
        name: 'Test Product',
        price: 1500,
        stock: 10,
        stockMin: 5,
        supplier: 'Test Supplier',
        categoryId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('navigates to products list on successful creation', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockStore = useProductsStore();
    mockStore.create.mockResolvedValueOnce({ id: 'p-1' } as Product);

    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/products', name: 'products-list', component: { template: '<div>List</div>' } },
      ],
    });

    const wrapper = mount(ProductCreatePage, {
      global: {
        plugins: [router],
        mocks: { $t: (k: string) => k },
      },
    });

    await wrapper.find('#field-sku').setValue('SKU-001');
    await wrapper.find('#field-name').setValue('Test Product');
    await wrapper.find('#field-price').setValue(1500);
    await wrapper.find('#field-stock').setValue(0);
    await wrapper.find('#field-stockMin').setValue(5);
    await wrapper.find('#field-supplier').setValue('Test Supplier');
    await wrapper.find('#create-category').setValue('22222222-2222-4222-8222-222222222222');

    await wrapper.find('form').trigger('submit.prevent');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('products-list');
  });

  it('shows SKU conflict error inline when backend returns SKU error', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockStore = useProductsStore();
    mockStore.create.mockRejectedValueOnce({
      data: { message: 'SKU already exists' },
    });

    const wrapper = createWrapper();

    await wrapper.find('#field-sku').setValue('EXISTING-SKU');
    await wrapper.find('#field-name').setValue('Test Product');
    await wrapper.find('#field-price').setValue(1500);
    await wrapper.find('#field-stock').setValue(0);
    await wrapper.find('#field-stockMin').setValue(5);
    await wrapper.find('#field-supplier').setValue('Test Supplier');
    await wrapper.find('#create-category').setValue('22222222-2222-4222-8222-222222222222');

    await wrapper.find('form').trigger('submit.prevent');

    expect(wrapper.find('#field-sku-error').text()).toContain('Ya existe');
  });

  it('validates price must be greater than zero', async () => {
    const wrapper = createWrapper();

    await wrapper.find('#field-price').setValue(0);
    await wrapper.find('form').trigger('submit.prevent');

    expect(wrapper.find('#field-price-error').text()).toContain('mayor que cero');
  });

  it('validates stock minimum must be positive', async () => {
    const wrapper = createWrapper();

    await wrapper.find('#field-stockMin').setValue(0);
    await wrapper.find('form').trigger('submit.prevent');

    expect(wrapper.find('#field-stockMin-error').text()).toContain('mayor que cero');
  });
});

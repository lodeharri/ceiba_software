/**
 * Unit tests for ProductsListPage component.
 * Tests filter synchronization between parent and FilterStrip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { setActivePinia, createPinia } from 'pinia';

// Mock stores
vi.mock('@/stores/products', () => ({
  useProductsStore: vi.fn().mockReturnValue({
    items: [],
    total: 0,
    page: 1,
    size: 20,
    loading: false,
    error: null,
    fetchList: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, size: 20, hasMore: false }),
  }),
}));

vi.mock('@/stores/categories', () => ({
  useCategoriesStore: vi.fn().mockReturnValue({
    items: [
      { id: 'cat-1', name: 'Bebidas' },
      { id: 'cat-2', name: 'Snacks' },
    ],
    fetchList: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Import after mocks
import ProductsListPage from './ProductsListPage.vue';

function createWrapper() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
  });

  return mount(ProductsListPage, {
    global: {
      plugins: [router],
      mocks: { $t: (k: string) => k },
    },
  });
}

describe('ProductsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it('initial fetch uses empty filters', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockFetchList = useProductsStore().fetchList;

    createWrapper();

    // Wait for onMounted to execute
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetchList).toHaveBeenCalledWith({});
  });

  it('handleSearch uses current filters.value', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockStore = useProductsStore();

    const wrapper = createWrapper();
    await new Promise((r) => setTimeout(r, 10));

    // Simulate FilterStrip emitting update:modelValue with a category filter
    const filterStrip = wrapper.findComponent({ name: 'FilterStrip' });
    await filterStrip.vm.$emit('update:modelValue', { categoryId: 'cat-1' });

    // Simulate search event
    await filterStrip.vm.$emit('search');

    // fetchList should have been called with the updated filters (page resets to 1 on search)
    expect(mockStore.fetchList).toHaveBeenLastCalledWith({ categoryId: 'cat-1', page: 1 });
  });

  it('category selection updates filters and triggers search', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockStore = useProductsStore();

    const wrapper = createWrapper();
    await new Promise((r) => setTimeout(r, 10));

    // The FilterStrip component should update parent filters on change
    const filterStrip = wrapper.findComponent({ name: 'FilterStrip' });

    // Emit a category change
    await filterStrip.vm.$emit('update:modelValue', { categoryId: 'cat-2' });
    await filterStrip.vm.$emit('search');

    expect(mockStore.fetchList).toHaveBeenLastCalledWith({ categoryId: 'cat-2', page: 1 });
  });

  it('clearing filters triggers search with empty filters', async () => {
    const { useProductsStore } = vi.mocked(await import('@/stores/products')) as {
      useProductsStore: ReturnType<typeof vi.fn>;
    };
    const mockStore = useProductsStore();

    const wrapper = createWrapper();
    await new Promise((r) => setTimeout(r, 10));

    const filterStrip = wrapper.findComponent({ name: 'FilterStrip' });

    // First set some filters
    await filterStrip.vm.$emit('update:modelValue', { categoryId: 'cat-1', supplier: 'Test' });
    await filterStrip.vm.$emit('search');

    // Then clear them
    await filterStrip.vm.$emit('update:modelValue', {});
    await filterStrip.vm.$emit('search');

    // Should search with empty filters + page reset to 1
    expect(mockStore.fetchList).toHaveBeenLastCalledWith({ page: 1 });
  });

  // Bug fix: categories error banner should display when fetch fails
  it('shows categories error banner when categories.error is set', async () => {
    const { useCategoriesStore } = vi.mocked(await import('@/stores/categories')) as {
      useCategoriesStore: ReturnType<typeof vi.fn>;
    };
    const mockCategoriesStore = useCategoriesStore();
    mockCategoriesStore.error = 'Error al cargar categorías';

    const wrapper = createWrapper();
    await new Promise((r) => setTimeout(r, 10));

    // Find the categories error banner by its text content
    const categoriesError = wrapper
      .findAll('div[role="alert"]')
      .find((div) => div.text() === 'Error al cargar categorías');

    expect(categoriesError).toBeDefined();
  });

  // Bug fix: create button should navigate to product-create route
  it('+ Nuevo producto button navigates to product-create route', async () => {
    // Use a shared router with the product-create route defined
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', redirect: { name: 'products-list' } },
        {
          path: '/productos',
          name: 'products-list',
          component: { template: '<div>Products</div>' },
        },
        {
          path: '/productos/nuevo',
          name: 'product-create',
          component: { template: '<div>Create Product</div>' },
        },
      ],
    });

    const wrapper = mount(ProductsListPage, {
      global: {
        plugins: [router],
        mocks: { $t: (k: string) => k },
      },
    });

    await router.isReady();

    // Find and click the create button
    const createButton = wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('products.newProduct'));
    expect(createButton).toBeDefined();

    await createButton!.trigger('click');
    // Wait for router navigation to complete
    await new Promise((r) => setTimeout(r, 50));
    await router.isReady();

    // Router should have navigated to product-create
    expect(router.currentRoute.value.name).toBe('product-create');
  });
});

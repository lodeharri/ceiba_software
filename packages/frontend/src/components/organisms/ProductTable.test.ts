/**
 * Unit tests for ProductTable component.
 * Verifies category display logic: ProductTable accepts a categories prop
 * and looks up the category name by product.categoryId.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ProductTable from './ProductTable.vue';

function createWrapper(props?: Record<string, unknown>) {
  return mount(ProductTable, {
    props: {
      products: [],
      categories: [],
      loading: false,
      ...props,
    },
    global: {
      mocks: { $t: (k: string) => k },
    },
  });
}

const CAT_BEBIDAS = { id: 'cat-1', name: 'Bebidas' };
const CAT_SNACKS = { id: 'cat-2', name: 'Snacks' };

const makeProduct = (overrides: Partial<Record<string, string | number>> = {}) =>
  ({
    id: 'p-1',
    sku: 'SKU001',
    name: 'Agua mineral',
    supplier: 'Acme',
    stock: 10,
    stockMin: 5,
    categoryId: 'cat-1',
    ...overrides,
  }) as unknown as {
    id: string;
    sku: string;
    name: string;
    supplier: string;
    stock: number;
    stockMin: number;
    categoryId: string;
  };

describe('ProductTable category display', () => {
  it('shows em-dash when no categories prop is provided', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ categoryId: 'cat-1' })],
    });
    expect(wrapper.text()).toContain('—');
  });

  it('looks up category name from categories prop by categoryId', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ categoryId: 'cat-1' })],
      categories: [CAT_BEBIDAS, CAT_SNACKS],
    });
    expect(wrapper.text()).toContain('Bebidas');
    expect(wrapper.text()).not.toContain('—');
  });

  it('renders different names for products in different categories', () => {
    const wrapper = createWrapper({
      products: [
        makeProduct({ id: 'p-1', categoryId: 'cat-1' }),
        makeProduct({ id: 'p-2', categoryId: 'cat-2' }),
      ],
      categories: [CAT_BEBIDAS, CAT_SNACKS],
    });
    expect(wrapper.text()).toContain('Bebidas');
    expect(wrapper.text()).toContain('Snacks');
  });

  it('shows em-dash when product has no categoryId', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ categoryId: undefined as unknown as string })],
      categories: [CAT_BEBIDAS],
    });
    expect(wrapper.text()).toContain('—');
  });

  it('shows em-dash when categoryId does not exist in the categories list', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ categoryId: 'unknown-cat' })],
      categories: [CAT_BEBIDAS],
    });
    expect(wrapper.text()).toContain('—');
  });
});

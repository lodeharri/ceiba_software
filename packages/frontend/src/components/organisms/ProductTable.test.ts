/**
 * Unit tests for ProductTable component.
 * Verifies category display logic: ProductTable accepts a categories prop
 * and looks up the category name by product.categoryId.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ProductTable from './ProductTable.vue';
import StatusBadge from '@/components/molecules/StatusBadge.vue';

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

describe('ProductTable stock status', () => {
  // stock === 0 → danger badge shows "Sin stock"
  it('renders danger badge with "Sin stock" when stock is zero', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ stock: 0, stockMin: 5 })],
    });
    const badge = wrapper.findComponent(StatusBadge);
    expect(badge.props('status')).toBe('danger');
    expect(wrapper.text()).toContain('Sin stock');
  });

  // 0 < stock <= stockMin → stock_low badge shows "Stock bajo"
  it('renders stock_low badge when stock is between 1 and stockMin', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ stock: 3, stockMin: 5 })],
    });
    const badge = wrapper.findComponent(StatusBadge);
    expect(badge.props('status')).toBe('stock_low');
    expect(wrapper.text()).toContain('Stock bajo');
  });

  it('renders stock_low badge when stock equals stockMin', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ stock: 5, stockMin: 5 })],
    });
    const badge = wrapper.findComponent(StatusBadge);
    expect(badge.props('status')).toBe('stock_low');
    expect(wrapper.text()).toContain('Stock bajo');
  });

  // stockMin < stock <= stockMin * 2 → warning badge (hardcoded "⚠ Advertencia" in StatusBadge)
  it('renders warning badge when stock is just above stockMin', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ stock: 6, stockMin: 5 })],
    });
    const badge = wrapper.findComponent(StatusBadge);
    expect(badge.props('status')).toBe('warning');
    // StatusBadge hardcodes the warning label as "Advertencia"
    expect(wrapper.text()).toContain('Advertencia');
  });

  it('renders warning badge when stock equals stockMin * 2', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ stock: 10, stockMin: 5 })],
    });
    const badge = wrapper.findComponent(StatusBadge);
    expect(badge.props('status')).toBe('warning');
    expect(wrapper.text()).toContain('Advertencia');
  });

  // stock > stockMin * 2 → ok badge (hardcoded "✓ OK" in StatusBadge)
  it('renders ok badge when stock is above stockMin * 2', () => {
    const wrapper = createWrapper({
      products: [makeProduct({ stock: 11, stockMin: 5 })],
    });
    const badge = wrapper.findComponent(StatusBadge);
    expect(badge.props('status')).toBe('ok');
    // StatusBadge hardcodes the ok label as "OK"
    expect(wrapper.text()).toContain('OK');
  });
});

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

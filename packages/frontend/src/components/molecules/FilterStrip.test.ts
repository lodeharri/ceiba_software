/**
 * Unit tests for FilterStrip component.
 * Tests filter synchronization between FilterStrip and parent via v-model.
 * Bugs tested:
 * 1. clear() does not emit update:modelValue before emit('search') - stale filters remain
 * 2. hasActiveAlert: false || undefined = undefined when unchecked
 * 3. minStock/maxStock emit empty string from cleared v-model.number
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import FilterStrip from './FilterStrip.vue';

const CATEGORIES = [
  { id: 'cat-1', name: 'Bebidas' },
  { id: 'cat-2', name: 'Snacks' },
];

describe('FilterStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Bug 1: clear() does not emit update:modelValue before emit('search') ──

  it('clear() emits update:modelValue with all filters cleared', async () => {
    const updateHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        'onUpdate:modelValue': updateHandler,
        onSearch: vi.fn(),
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    // Set some filters first
    const categorySelect = wrapper.find('select#filter-category');
    await categorySelect.setValue('cat-1');

    // Find and click the clear button (it only appears when hasFilters is true)
    const clearButtons = wrapper.findAll('button');
    const clearBtn = clearButtons.find((b) => b.text().includes('common.clearFilters'));
    expect(clearBtn).toBeDefined();
    await clearBtn!.trigger('click');

    // Verify update:modelValue was emitted with all filters cleared
    // After clear(), hasActiveAlert resets to false (not undefined) per the default
    expect(updateHandler).toHaveBeenLastCalledWith({
      categoryId: undefined,
      supplier: undefined,
      hasActiveAlert: false,
      minStock: undefined,
      maxStock: undefined,
    });
  });

  it('parent filters are empty after clear (not stale)', async () => {
    const updateHandler = vi.fn();
    const searchHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        modelValue: { categoryId: 'cat-1', supplier: 'Test' },
        'onUpdate:modelValue': updateHandler,
        onSearch: searchHandler,
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    // Clear filters
    const clearBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('common.clearFilters'));
    await clearBtn!.trigger('click');

    // The update:modelValue should contain empty filters, not the stale values
    const emittedValue = updateHandler.mock.calls[0]![0] as Record<string, unknown>;
    expect(emittedValue.categoryId).toBeUndefined();
    expect(emittedValue.supplier).toBeUndefined();
  });

  // ── Bug 2: hasActiveAlert emits undefined when unchecked (false || undefined) ──

  it('emitUpdate includes hasActiveAlert=false when checkbox is unchecked', async () => {
    const updateHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        'onUpdate:modelValue': updateHandler,
        onSearch: vi.fn(),
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    // The checkbox starts unchecked (hasActiveAlert = false)
    // Click search button
    const searchBtn = wrapper.findAll('button').find((b) => b.text().includes('common.search'));
    await searchBtn!.trigger('click');

    // hasActiveAlert should be explicitly false (not undefined due to false || undefined)
    const emittedFilters = updateHandler.mock.calls[0]![0] as Record<string, unknown>;
    expect(emittedFilters.hasActiveAlert).toBe(false);
  });

  it('emitUpdate includes hasActiveAlert=true when checkbox is checked', async () => {
    const updateHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        'onUpdate:modelValue': updateHandler,
        onSearch: vi.fn(),
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    // Check the checkbox
    await wrapper.find('input[type="checkbox"]').setValue(true);
    const searchBtn = wrapper.findAll('button').find((b) => b.text().includes('common.search'));
    await searchBtn!.trigger('click');

    const emittedFilters = updateHandler.mock.calls[0]![0] as Record<string, unknown>;
    expect(emittedFilters.hasActiveAlert).toBe(true);
  });

  // ── Bug 3: minStock/maxStock emit empty string from cleared v-model.number ──

  it('minStock emits undefined (not empty string) when input is cleared', async () => {
    const updateHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        'onUpdate:modelValue': updateHandler,
        onSearch: vi.fn(),
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    // Type a value then clear it (simulates user typing and backspacing)
    const minStockInput = wrapper.find('input#filter-min-stock');
    await minStockInput.setValue('10');
    await minStockInput.setValue('');
    // v-model.number converts empty string to empty string (not undefined)

    const searchBtn = wrapper.findAll('button').find((b) => b.text().includes('common.search'));
    await searchBtn!.trigger('click');

    const emittedFilters = updateHandler.mock.calls[0]![0] as Record<string, unknown>;
    // Empty string from cleared number input should become undefined
    expect(emittedFilters.minStock).not.toBe('');
    expect(emittedFilters.minStock).toBeUndefined();
  });

  it('maxStock emits undefined (not empty string) when input is cleared', async () => {
    const updateHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        'onUpdate:modelValue': updateHandler,
        onSearch: vi.fn(),
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    const maxStockInput = wrapper.find('input#filter-max-stock');
    await maxStockInput.setValue('100');
    await maxStockInput.setValue('');

    const searchBtn = wrapper.findAll('button').find((b) => b.text().includes('common.search'));
    await searchBtn!.trigger('click');

    const emittedFilters = updateHandler.mock.calls[0]![0] as Record<string, unknown>;
    expect(emittedFilters.maxStock).not.toBe('');
    expect(emittedFilters.maxStock).toBeUndefined();
  });

  it('valid minStock/maxStock numbers are preserved in emitUpdate', async () => {
    const updateHandler = vi.fn();
    const wrapper = mount(FilterStrip, {
      props: {
        categories: CATEGORIES,
        'onUpdate:modelValue': updateHandler,
        onSearch: vi.fn(),
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    await wrapper.find('input#filter-min-stock').setValue(5);
    await wrapper.find('input#filter-max-stock').setValue(50);
    const searchBtn = wrapper.findAll('button').find((b) => b.text().includes('common.search'));
    await searchBtn!.trigger('click');

    const emittedFilters = updateHandler.mock.calls[0]![0] as Record<string, unknown>;
    expect(emittedFilters.minStock).toBe(5);
    expect(emittedFilters.maxStock).toBe(50);
  });
});

<script setup lang="ts">
/**
 * FilterStrip — category select + supplier input + hasActiveAlert toggle + min/max stock.
 * Embedded in ProductsListPage (design.md §8.6 wireframe).
 */
import { ref, computed } from 'vue';
import type { ProductFilters } from '@/services/products';

interface Props {
  categories: Array<{ id: string; name: string }>;
  modelValue?: ProductFilters;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({}),
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: ProductFilters): void;
  (e: 'search'): void;
}>();

const categoryId = ref(props.modelValue.categoryId ?? '');
const supplier = ref(props.modelValue.supplier ?? '');
const hasActiveAlert = ref(props.modelValue.hasActiveAlert ?? false);
// v-model.number on <input type="number"> yields '' when the field is cleared;
// explicitly type as number|string|undefined to reflect the HTML input reality.
const minStock = ref<number | string | undefined>(props.modelValue.minStock);
const maxStock = ref<number | string | undefined>(props.modelValue.maxStock);

function emitUpdate() {
  emit('update:modelValue', {
    categoryId: categoryId.value || undefined,
    supplier: supplier.value || undefined,
    hasActiveAlert: hasActiveAlert.value,
    // v-model.number yields '' when the input is cleared; coerce to
    // undefined so the backend ignores the key instead of treating it
    // as minStock=0 (which would match every product).  Also convert
    // any intermediate string value to number (the ref is number|string|undefined).
    minStock: (minStock.value ?? '') === '' ? undefined : Number(minStock.value),
    maxStock: (maxStock.value ?? '') === '' ? undefined : Number(maxStock.value),
  });
}

function clear() {
  categoryId.value = '';
  supplier.value = '';
  hasActiveAlert.value = false;
  minStock.value = undefined;
  maxStock.value = undefined;
  emitUpdate();
  emit('search');
}

function handleSearch() {
  emitUpdate();
  emit('search');
}

const hasFilters = computed(
  () =>
    categoryId.value ||
    supplier.value ||
    hasActiveAlert.value ||
    minStock.value !== undefined ||
    maxStock.value !== undefined,
);
</script>

<template>
  <div class="border border-muted rounded-card p-4 flex flex-col gap-3 bg-card">
    <div class="flex flex-wrap items-end gap-3">
      <!-- Category select -->
      <div class="flex flex-col gap-1 min-w-[160px]">
        <label for="filter-category" class="text-xs font-medium text-text-muted">
          {{ $t('products.filterCategory') }}
        </label>
        <select
          id="filter-category"
          v-model="categoryId"
          class="border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 transition-all duration-hover"
          @change="handleSearch"
        >
          <option value="">{{ $t('products.allCategories') }}</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">
            {{ cat.name }}
          </option>
        </select>
      </div>

      <!-- Supplier input -->
      <div class="flex flex-col gap-1 min-w-[160px]">
        <label for="filter-supplier" class="text-xs font-medium text-text-muted">
          {{ $t('products.filterSupplier') }}
        </label>
        <input
          id="filter-supplier"
          v-model="supplier"
          type="text"
          class="border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 placeholder:text-text-muted transition-all duration-hover"
          :placeholder="$t('products.filterSupplierPlaceholder')"
          @keyup.enter="handleSearch"
        />
      </div>

      <!-- Min stock -->
      <div class="flex flex-col gap-1 w-24">
        <label for="filter-min-stock" class="text-xs font-medium text-text-muted">
          {{ $t('products.filterStockMin') }}
        </label>
        <input
          id="filter-min-stock"
          v-model.number="minStock"
          type="number"
          min="0"
          class="border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 transition-all duration-hover"
          @keyup.enter="handleSearch"
        />
      </div>

      <!-- Max stock -->
      <div class="flex flex-col gap-1 w-24">
        <label for="filter-max-stock" class="text-xs font-medium text-text-muted">
          {{ $t('products.filterStockMax') }}
        </label>
        <input
          id="filter-max-stock"
          v-model.number="maxStock"
          type="number"
          min="0"
          class="border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 transition-all duration-hover"
          @keyup.enter="handleSearch"
        />
      </div>

      <!-- Active alert toggle -->
      <label class="flex items-center gap-2 cursor-pointer h-9 self-end">
        <input v-model="hasActiveAlert" type="checkbox" class="accent-primary w-4 h-4" />
        <span class="text-sm text-text whitespace-nowrap">{{ $t('products.hasActiveAlert') }}</span>
      </label>

      <!-- Search -->
      <button
        type="button"
        class="h-9 px-4 border border-primary bg-primary text-card text-sm rounded-atom hover:bg-primary-hover transition-all duration-hover"
        @click="handleSearch"
      >
        {{ $t('common.search') }}
      </button>

      <!-- Clear -->
      <button
        v-if="hasFilters"
        type="button"
        class="h-9 px-3 border border-muted text-text-muted text-sm rounded-atom hover:border-primary hover:text-primary transition-all duration-hover"
        @click="clear"
      >
        {{ $t('common.clearFilters') }}
      </button>
    </div>
  </div>
</template>

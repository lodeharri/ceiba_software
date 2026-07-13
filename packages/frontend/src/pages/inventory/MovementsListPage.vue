<script setup lang="ts">
/**
 * MovementsListPage — all movements across products with filter by product + type.
 */
import { ref, onMounted, computed } from 'vue';
import { useProductsStore } from '@/stores/products';
import { useInventoryStore } from '@/stores/inventory';
import MovementHistoryTable from '@/components/organisms/MovementHistoryTable.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';
import type { Movement } from '@/services/inventory';

const products = useProductsStore();
const inventory = useInventoryStore();

const selectedProductId = ref<string>('');
const page = ref(1);

const allMovements = computed((): Movement[] => {
  if (!selectedProductId.value) {
    // Show all movements by concatenating all product maps
    const all: Movement[] = [];
    products.items.forEach((p) => {
      all.push(...inventory.getMovementsForProduct(p.id));
    });
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return inventory.getMovementsForProduct(selectedProductId.value);
});

// In "all products" mode (no selectedProductId), pagination is not applicable —
// pre-loaded movements are shown without pagination controls.
const showPagination = computed(() => !!selectedProductId.value);

onMounted(async () => {
  await products.fetchList({ size: 100 });
  // Pre-load movements for all products
  await Promise.all(products.items.map((p) => inventory.fetchMovements(p.id, { size: 50 })));
});

async function handlePage(p: number) {
  page.value = p;
  if (selectedProductId.value) {
    await inventory.fetchMovements(selectedProductId.value, { page: p });
  }
}
</script>

<template>
  <div>
    <p class="eyebrow mb-2 mt-6">P.02 — MOVIMIENTOS</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
    <PageHeader :title="$t('inventory.allMovements')" />

    <!-- Filters -->
    <div class="flex flex-wrap gap-4 mb-4">
      <div class="flex flex-col gap-1">
        <label for="movements-product-filter" class="text-xs font-medium text-text-muted">
          {{ $t('inventory.filterProduct') }}
        </label>
        <select
          id="movements-product-filter"
          v-model="selectedProductId"
          class="border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary"
        >
          <option value="">{{ $t('inventory.allProducts') }}</option>
          <option v-for="p in products.items" :key="p.id" :value="p.id">
            {{ p.name }} ({{ p.sku }})
          </option>
        </select>
      </div>
    </div>

    <MovementHistoryTable
      v-if="showPagination"
      :movements="allMovements"
      :loading="inventory.loading"
      :page="page"
      :size="50"
      :total="inventory.currentTotal"
      :has-more="inventory.currentHasMore"
      @page="handlePage"
    />
    <div v-else class="text-sm text-text-muted py-8 text-center">
      {{ $t('inventory.allProducts') }} — {{ allMovements.length }}
      {{ $t('inventory.movements').toLowerCase() }}
    </div>
  </div>
</template>

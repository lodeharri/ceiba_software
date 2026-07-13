<script setup lang="ts">
/**
 * ProductsListPage — hero wireframe per §8.6.
 * Embeds FilterStrip + ProductTable + pagination footer.
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProductsStore } from '@/stores/products';
import { useCategoriesStore } from '@/stores/categories';
import ProductTable from '@/components/organisms/ProductTable.vue';
import FilterStrip from '@/components/molecules/FilterStrip.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';
import Button from '@/components/atoms/Button.vue';
import PaginationControl from '@/components/molecules/PaginationControl.vue';
import type { ProductFilters } from '@/services/products';

const products = useProductsStore();
const categories = useCategoriesStore();
const router = useRouter();

const filters = ref<ProductFilters>({});

onMounted(async () => {
  await Promise.all([products.fetchList(filters.value), categories.fetchList()]);
});

async function handleSearch() {
  filters.value.page = 1;
  await products.fetchList(filters.value);
}

async function goToPage(p: number) {
  await products.fetchList({ ...filters.value, page: p });
}

function goToCreate() {
  router.push({ name: 'product-create' });
}
</script>

<template>
  <div>
    <p class="eyebrow mb-2 mt-6">P.01 — PRODUCTOS</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
    <PageHeader :title="$t('products.title')">
      <Button size="sm" @click="goToCreate"> + {{ $t('products.newProduct') }} </Button>
    </PageHeader>

    <FilterStrip v-model="filters" :categories="categories.items" @search="handleSearch" />

    <div class="mt-4">
      <!-- Products error banner -->
      <div
        v-if="products.error"
        class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
        role="alert"
      >
        {{ products.error }}
      </div>

      <!-- Categories error banner -->
      <div
        v-if="categories.error"
        class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
        role="alert"
      >
        {{ categories.error }}
      </div>

      <ProductTable
        :products="products.items"
        :categories="categories.items"
        :loading="products.loading"
      />

      <!-- Pagination -->
      <div v-if="products.total > 0" class="mt-4">
        <PaginationControl
          :page="products.page"
          :size="products.size"
          :total="products.total"
          :has-more="products.hasMore"
          :disabled="products.loading"
          @update:page="goToPage"
        />
      </div>
    </div>
  </div>
</template>

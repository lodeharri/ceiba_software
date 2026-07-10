<script setup lang="ts">
/**
 * ProductTable — main products list organism.
 * Design: §8.6 wireframe — monospace SKU, large mono stock (weight 700), 48px rows.
 * Row click navigates to product detail.
 */

import { useRouter } from 'vue-router';
import StatusBadge from '@/components/molecules/StatusBadge.vue';
import type { Product } from '@/services/products';

interface Props {
  products: Product[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), { loading: false });
void props; // expose to template without unused var warning
const router = useRouter();

function stockStatus(product: Product): 'ok' | 'warning' | 'danger' {
  if (product.stock === 0 || product.stock <= product.stockMin) return 'danger';
  if (product.stock <= product.stockMin * 2) return 'warning';
  return 'ok';
}

function stockLabel(product: Product): string {
  if (product.stock === 0) return 'Sin stock';
  if (product.stock <= product.stockMin) return 'Bajo mínimo';
  if (product.stock <= product.stockMin * 2) return 'Cerca del mínimo';
  return 'Stock OK';
}

function navigateToDetail(id: string) {
  router.push({ name: 'product-detail', params: { id } });
}

function getCategoryName(product: Product): string {
  return ((product as Record<string, unknown>).categoryName as string) ?? '—';
}
</script>

<template>
  <div class="border border-muted rounded-card overflow-hidden bg-card shadow-sm">
    <!-- Table -->
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-muted bg-surface">
            <th
              class="text-left px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide w-32"
            >
              {{ $t('products.sku') }}
            </th>
            <th
              class="text-left px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide"
            >
              {{ $t('products.name') }}
            </th>
            <th
              class="text-left px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide hidden md:table-cell"
            >
              {{ $t('products.category') }}
            </th>
            <th
              class="text-right px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide w-24"
            >
              {{ $t('products.stock') }}
            </th>
            <th
              class="text-right px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide w-20 hidden sm:table-cell"
            >
              {{ $t('products.stockMin') }}
            </th>
            <th
              class="text-center px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide w-28"
            >
              {{ $t('products.status') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Loading skeletons -->
          <tr v-if="loading" class="border-b border-muted last:border-0">
            <td colspan="6" class="px-4 py-12 text-center text-text-muted">
              {{ $t('common.loading') }}
            </td>
          </tr>
          <!-- Empty state -->
          <tr v-else-if="products.length === 0" class="border-b border-muted last:border-0">
            <td colspan="6" class="px-4 py-12 text-center text-text-muted">
              {{ $t('empty.products') }}
            </td>
          </tr>
          <!-- Product rows -->
          <tr
            v-for="product in products"
            :key="product.id"
            class="border-b border-muted last:border-0 cursor-pointer hover:bg-surface transition-colors duration-hover"
            style="height: 48px"
            @click="navigateToDetail(product.id)"
          >
            <!-- SKU — JetBrains Mono -->
            <td class="px-4 py-3 font-mono text-xs text-text-muted whitespace-nowrap">
              {{ product.sku }}
            </td>
            <!-- Name -->
            <td class="px-4 py-3 font-medium text-text truncate max-w-0">
              <span class="block truncate">{{ product.name }}</span>
              <span class="text-xs text-text-muted md:hidden">{{ product.supplier }}</span>
            </td>
            <!-- Category (hidden on mobile) -->
            <td class="px-4 py-3 text-text-muted hidden md:table-cell">
              {{ getCategoryName(product) }}
            </td>
            <!-- Stock — large mono weight 700 -->
            <td class="px-4 py-3 text-right">
              <span
                class="font-mono text-base font-bold"
                :class="
                  stockStatus(product) === 'danger'
                    ? 'text-danger'
                    : stockStatus(product) === 'warning'
                      ? 'text-warning'
                      : 'text-text'
                "
                :aria-label="stockLabel(product)"
              >
                {{ product.stock }}
              </span>
            </td>
            <!-- StockMin — muted -->
            <td class="px-4 py-3 text-right text-text-muted font-mono text-sm hidden sm:table-cell">
              {{ product.stockMin }}
            </td>
            <!-- Status badge -->
            <td class="px-4 py-3 text-center">
              <StatusBadge :status="stockStatus(product)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

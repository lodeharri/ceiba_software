<script setup lang="ts">
/**
 * OrdersListPage — table with status badge per row, newest first.
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useOrdersStore } from '@/stores/orders';
import StatusBadge from '@/components/molecules/StatusBadge.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';
import Button from '@/components/atoms/Button.vue';
import EmptyState from '@/components/molecules/EmptyState.vue';
import PaginationControl from '@/components/molecules/PaginationControl.vue';

const orders = useOrdersStore();
const router = useRouter();
const statusFilter = ref<string | undefined>(undefined);

onMounted(() => orders.fetchList({ status: statusFilter.value }));

async function setFilter(s: string | undefined) {
  statusFilter.value = s;
  await orders.fetchList({ status: s, page: 1 });
}

async function goToPage(p: number) {
  await orders.fetchList({ status: statusFilter.value, page: p });
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' }).format(new Date(iso));
}
</script>

<template>
  <div>
    <p class="eyebrow mb-2 mt-6">P.04 — PEDIDOS</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
    <PageHeader :title="$t('orders.title')">
      <Button size="sm" @click="router.push({ name: 'order-create' })">
        + {{ $t('orders.newOrder') }}
      </Button>
    </PageHeader>

    <div
      v-if="orders.error"
      class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
      role="alert"
    >
      {{ orders.error }}
    </div>

    <div v-if="orders.loading" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="orders.items.length === 0" class="mt-2">
      <EmptyState :message="$t('empty.orders')">
        <template #action>
          <Button size="sm" @click="router.push({ name: 'order-create' })">
            + {{ $t('orders.newOrder') }}
          </Button>
        </template>
      </EmptyState>
    </div>

    <div v-else class="border border-muted rounded-card overflow-hidden bg-card">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-muted">
            <th class="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">
              Producto
            </th>
            <th class="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">
              Cant.
            </th>
            <th class="text-center px-4 py-3 text-xs font-medium text-text-muted uppercase">
              Estado
            </th>
            <th
              class="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase hidden md:table-cell"
            >
              Fecha
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="order in orders.items"
            :key="order.id"
            class="border-b border-muted last:border-0 cursor-pointer hover:bg-surface transition-colors"
            style="height: 48px"
            @click="router.push({ name: 'order-detail', params: { id: order.id } })"
          >
            <td class="px-4 py-3 text-text truncate">
              <span class="font-medium">{{ order.productName }}</span>
              <span class="block text-xs text-text-muted font-mono mt-0.5">
                {{ order.productSku }} · #{{ order.id.slice(0, 8) }}
              </span>
            </td>
            <td class="px-4 py-3 text-right font-mono text-text font-semibold">
              {{ order.quantity }}
            </td>
            <td class="px-4 py-3 text-center">
              <StatusBadge :status="order.status" />
            </td>
            <td class="px-4 py-3 text-right text-text-muted text-xs hidden md:table-cell">
              {{ formatDate(order.createdAt) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="orders.total > 0" class="mt-4">
      <PaginationControl
        :page="orders.page"
        :size="orders.size"
        :total="orders.total"
        :has-more="orders.hasMore"
        :disabled="orders.loading"
        @update:page="goToPage"
      />
    </div>
  </div>
</template>

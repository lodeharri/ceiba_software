<script setup lang="ts">
/**
 * OrdersListPage — table with status badge per row, newest first.
 */
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useOrdersStore } from '@/stores/orders';
import StatusBadge from '@/components/molecules/StatusBadge.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';
import Button from '@/components/atoms/Button.vue';

const orders = useOrdersStore();
const router = useRouter();

onMounted(() => orders.fetchList());

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' }).format(new Date(iso));
}
</script>

<template>
  <div>
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

    <div v-else-if="orders.items.length === 0" class="text-center text-text-muted py-12">
      {{ $t('orders.noOrders') }}
    </div>

    <div v-else class="border border-muted rounded-card overflow-hidden bg-card">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-muted">
            <th class="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">ID</th>
            <th
              class="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase hidden md:table-cell"
            >
              Producto
            </th>
            <th class="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">
              Cant.
            </th>
            <th class="text-center px-4 py-3 text-xs font-medium text-text-muted uppercase">
              Estado
            </th>
            <th class="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">
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
            <td class="px-4 py-3 font-mono text-xs text-text-muted truncate max-w-[80px]">
              {{ order.id.slice(0, 8) }}
            </td>
            <td class="px-4 py-3 text-text truncate hidden md:table-cell">
              <span class="font-medium">{{ order.productName }}</span>
              <span class="text-text-muted ml-2 text-xs font-mono">{{ order.productSku }}</span>
            </td>
            <td class="px-4 py-3 text-right font-mono text-text">{{ order.quantity }}</td>
            <td class="px-4 py-3 text-center">
              <StatusBadge :status="order.status" />
            </td>
            <td class="px-4 py-3 text-right text-text-muted text-xs">
              {{ formatDate(order.createdAt) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

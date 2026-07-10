<script setup lang="ts">
/**
 * MovementHistoryTable — paginated movement list for a product.
 * Default size = 50 per Q-P2; ordered createdAt DESC.
 */
import StatusBadge from '@/components/molecules/StatusBadge.vue';
import type { Movement } from '@/services/inventory';

interface Props {
  movements: Movement[];
  loading?: boolean;
  page?: number;
  size?: number;
  total?: number;
}

withDefaults(defineProps<Props>(), {
  loading: false,
  page: 1,
  size: 50,
  total: 0,
});

const emit = defineEmits<{ (e: 'page', page: number): void }>();

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const from = (page: number, size: number, total: number) => Math.min((page - 1) * size + 1, total);
const to = (page: number, size: number, total: number) => Math.min(page * size, total);
</script>

<template>
  <div class="border border-muted rounded-card overflow-hidden bg-card shadow-sm">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-muted">
            <th
              class="text-left px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide"
            >
              {{ $t('inventory.type') }}
            </th>
            <th
              class="text-right px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide"
            >
              {{ $t('inventory.quantity') }}
            </th>
            <th
              class="text-left px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide hidden md:table-cell"
            >
              {{ $t('inventory.reason') }}
            </th>
            <th
              class="text-right px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide"
            >
              {{ $t('inventory.newStock') }}
            </th>
            <th
              class="text-right px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide"
            >
              {{ $t('inventory.createdAt') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading" class="border-b border-muted last:border-0">
            <td colspan="5" class="px-4 py-12 text-center text-text-muted">
              {{ $t('common.loading') }}
            </td>
          </tr>
          <tr v-else-if="movements.length === 0" class="border-b border-muted last:border-0">
            <td colspan="5" class="px-4 py-12 text-center text-text-muted">
              {{ $t('empty.movements') }}
            </td>
          </tr>
          <tr
            v-for="m in movements"
            :key="m.id"
            class="border-b border-muted last:border-0"
            style="height: 48px"
          >
            <td class="px-4 py-3">
              <StatusBadge :status="m.type" />
            </td>
            <td class="px-4 py-3 text-right font-mono text-text">
              {{ m.type === 'SALIDA' ? '-' : '+' }}{{ m.quantity }}
            </td>
            <td class="px-4 py-3 text-text-muted text-sm truncate max-w-0 hidden md:table-cell">
              <span class="block truncate">{{ m.reason }}</span>
            </td>
            <td class="px-4 py-3 text-right font-mono font-semibold text-text">
              {{ m.stockAfter }}
            </td>
            <td class="px-4 py-3 text-right text-text-muted text-xs font-mono">
              {{ formatDate(m.createdAt) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- Pagination footer -->
    <div
      v-if="total > 0"
      class="flex items-center justify-between px-4 py-3 border-t border-muted text-xs text-text-muted"
    >
      <span>{{
        $t('common.showing', { from: from(page, size, total), to: to(page, size, total), total })
      }}</span>
      <div class="flex gap-2">
        <button
          :disabled="page <= 1"
          class="px-3 py-1 border border-muted rounded-atom disabled:opacity-40 hover:border-primary transition-colors"
          @click="emit('page', page - 1)"
        >
          {{ $t('pagination.previous') }}
        </button>
        <button
          :disabled="page * size >= total"
          class="px-3 py-1 border border-muted rounded-atom disabled:opacity-40 hover:border-primary transition-colors"
          @click="emit('page', page + 1)"
        >
          {{ $t('pagination.next') }}
        </button>
      </div>
    </div>
  </div>
</template>

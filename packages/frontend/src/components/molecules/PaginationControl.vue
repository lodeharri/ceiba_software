<script setup lang="ts">
/**
 * PaginationControl — reusable molecule.
 * Renders "Showing X–Y of Z" + Previous/Next buttons.
 * Uses the same visual language as MovementHistoryTable.vue buttons.
 */
interface Props {
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:page', page: number): void;
}>();

const from = () => Math.min((props.page - 1) * props.size + 1, props.total);
const to = () => Math.min(props.page * props.size, props.total);
</script>

<template>
  <div
    class="flex items-center justify-between px-4 py-3 border border-muted rounded-card bg-card text-xs text-text-muted"
  >
    <span>{{ $t('common.showing', { from: from(), to: to(), total }) }}</span>
    <div class="flex gap-2">
      <button
        :disabled="disabled || page <= 1"
        aria-label="Página anterior"
        class="px-3 py-1 border border-muted rounded-atom disabled:opacity-40 hover:border-primary transition-colors"
        @click="emit('update:page', page - 1)"
      >
        ◀ {{ $t('pagination.previous') }}
      </button>
      <button
        :disabled="disabled || (!hasMore && page * size >= total)"
        aria-label="Página siguiente"
        class="px-3 py-1 border border-muted rounded-atom disabled:opacity-40 hover:border-primary transition-colors"
        @click="emit('update:page', page + 1)"
      >
        {{ $t('pagination.next') }} ▶
      </button>
    </div>
  </div>
</template>

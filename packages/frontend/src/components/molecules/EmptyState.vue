<script setup lang="ts">
/**
 * EmptyState — reusable molecule for "no data yet" screens.
 *
 * Always pairs a short message with an optional action slot. Following
 * frontend-design guidance, empty states are an invitation to act, not a
 * dead end — so the message names what the user can do next and the
 * `action` slot gives them a place to do it.
 *
 * Usage:
 *   <EmptyState :message="$t('empty.orders')">
 *     <Button size="sm" @click="router.push({ name: 'order-create' })">
 *       + {{ $t('orders.newOrder') }}
 *     </Button>
 *   </EmptyState>
 */
defineProps<{
  /** Short, action-oriented message. Should answer "what can I do?" not "nothing here". */
  message: string;
  /** Tone controls the accent stripe and icon glyph (no icon font dependency). */
  tone?: 'neutral' | 'success' | 'warning';
}>();
</script>

<template>
  <div
    class="border border-dashed border-muted rounded-card bg-surface/40 px-6 py-10 text-center"
    data-testid="empty-state"
    :data-tone="tone ?? 'neutral'"
  >
    <!-- Tone accent: a 1px-tall bar in the chosen tone. Cheap, no icon font. -->
    <div
      class="mx-auto mb-3 h-1 w-10 rounded-full"
      :class="{
        'bg-success': tone === 'success',
        'bg-warning': tone === 'warning',
        'bg-muted': !tone || tone === 'neutral',
      }"
    />
    <p class="text-sm text-text-muted max-w-md mx-auto">{{ message }}</p>
    <div v-if="$slots.action" class="mt-4 flex justify-center">
      <slot name="action" />
    </div>
  </div>
</template>

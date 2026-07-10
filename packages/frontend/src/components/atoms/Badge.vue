<script setup lang="ts">
/**
 * Badge atom — status pill.
 * Design: §8.2 — 6px radius, colored background per status.
 * Never conveys meaning by color alone — always carries icon or text prefix (§8.9).
 */
interface Props {
  variant?: 'success' | 'warning' | 'danger' | 'neutral';
}

withDefaults(defineProps<Props>(), {
  variant: 'neutral',
});
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-atom text-xs font-medium border',
      variant === 'success'
        ? 'bg-success text-card border-success'
        : variant === 'warning'
          ? 'bg-warning text-text border-warning'
          : variant === 'danger'
            ? 'bg-danger text-card border-danger'
            : 'bg-card text-text border-muted',
    ]"
    v-bind="$attrs"
  >
    <slot />
  </span>
</template>

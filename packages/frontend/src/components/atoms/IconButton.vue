<script setup lang="ts">
/**
 * IconButton — icon-only button with accessible aria-label.
 */
interface Props {
  label: string; // Required for accessibility
  variant?: 'ghost' | 'danger';
  disabled?: boolean;
  size?: 'sm' | 'md';
}

withDefaults(defineProps<Props>(), {
  variant: 'ghost',
  disabled: false,
  size: 'md',
});
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-label="label"
    :title="label"
    :class="[
      'inline-flex items-center justify-center border rounded-atom transition-all duration-hover ease-out',
      'cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
      size === 'sm' ? 'p-1.5' : 'p-2',
      variant === 'danger'
        ? 'border-danger text-danger hover:bg-danger hover:text-card'
        : 'border-muted text-text-muted hover:border-primary hover:text-primary',
      disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '',
    ]"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

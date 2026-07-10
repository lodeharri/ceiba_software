<script setup lang="ts">
/**
 * PageHeader — page title + optional CTA button slot.
 * Design: §8.6 wireframe — "Productos [+ Crear producto]"
 */
interface Props {
  title: string;
}

defineProps<Props>();
</script>

<template>
  <div class="flex items-center justify-between py-6 px-0">
    <h1 class="text-2xl font-semibold text-text">{{ title }}</h1>
    <div class="flex items-center gap-3">
      <slot />
    </div>
  </div>
</template>

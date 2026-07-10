<script setup lang="ts">
/**
 * AlertBadge — animated pulse for ACTIVA, static for RESUELTA.
 * Spanish aria-labels per design.md §8.9.
 */
interface Props {
  status: 'ACTIVA' | 'RESUELTA';
}

defineProps<Props>();
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-atom text-xs font-medium border',
      status === 'ACTIVA'
        ? 'bg-danger text-card border-danger'
        : 'bg-success text-card border-success',
    ]"
    :aria-label="
      status === 'ACTIVA' ? $t('accessibility.statusActive') : $t('accessibility.statusResolved')
    "
    role="status"
  >
    <!-- Animated pulse dot for ACTIVA -->
    <span v-if="status === 'ACTIVA'" class="relative flex h-2 w-2" aria-hidden="true">
      <span
        class="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"
      />
      <span class="relative inline-flex rounded-full h-2 w-2 bg-current" />
    </span>
    <!-- Static dot for RESUELTA -->
    <span v-else class="inline-block h-2 w-2 rounded-full bg-current" aria-hidden="true" />
    {{ status === 'ACTIVA' ? $t('alerts.alertActive') : $t('alerts.alertResolved') }}
  </span>
</template>

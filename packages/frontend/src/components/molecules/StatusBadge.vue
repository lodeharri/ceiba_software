<script setup lang="ts">
/**
 * StatusBadge — maps OrderStatus / AlertStatus to colored pill.
 * Design: §8.2 — icon prefix + colored pill per status.
 */
import { computed } from 'vue';
import Badge from '@/components/atoms/Badge.vue';

interface Props {
  status: string;
}

const props = defineProps<Props>();

const config: Record<
  string,
  { variant: 'success' | 'warning' | 'danger' | 'neutral'; label: string; icon: string }
> = {
  // Order statuses
  PENDIENTE: { variant: 'warning', label: 'Pendiente', icon: '⚠' },
  APROBADA: { variant: 'success', label: 'Aprobada', icon: '✓' },
  RECHAZADA: { variant: 'danger', label: 'Rechazada', icon: '✕' },
  RECIBIDA: { variant: 'success', label: 'Recibida', icon: '✓' },
  // Product stock statuses
  ok: { variant: 'success', label: 'OK', icon: '✓' },
  warning: { variant: 'warning', label: 'Advertencia', icon: '⚠' },
  danger: { variant: 'danger', label: 'Sin stock', icon: '✕' },
  // Alert statuses
  ACTIVA: { variant: 'danger', label: 'Activa', icon: '⚠' },
  RESUELTA: { variant: 'success', label: 'Resuelta', icon: '✓' },
  // Movement types
  ENTRADA: { variant: 'success', label: 'Entrada', icon: '↑' },
  SALIDA: { variant: 'warning', label: 'Salida', icon: '↓' },
};

const resolved = computed(() => {
  return config[props.status] ?? { variant: 'neutral' as const, label: props.status, icon: '' };
});
</script>

<template>
  <Badge :variant="resolved.variant">
    <span aria-hidden="true">{{ resolved.icon }}</span>
    {{ resolved.label }}
  </Badge>
</template>

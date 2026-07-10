<script setup lang="ts">
/**
 * AlertCard — product snapshot + status + CTA "Crear orden" with fromAlertId query param.
 */
import { useRouter } from 'vue-router';
import AlertBadge from '@/components/atoms/AlertBadge.vue';
import Button from '@/components/atoms/Button.vue';
import type { Alert } from '@/services/alerts';

interface Props {
  alert: Alert;
}

const props = defineProps<Props>();
const router = useRouter();

function goToOrder() {
  router.push({ name: 'order-create', query: { fromAlertId: props.alert.id } });
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
</script>

<template>
  <div class="border border-muted rounded-card p-4 bg-card shadow-sm flex flex-col gap-3">
    <!-- Product info -->
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-xs text-text-muted">{{ alert.productSku }}</p>
        <p class="font-medium text-text truncate">{{ alert.productName }}</p>
      </div>
      <AlertBadge :status="alert.status" />
    </div>

    <!-- Stock snapshot -->
    <div class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p class="text-xs text-text-muted">{{ $t('alerts.stockAtOpen') }}</p>
        <p class="font-mono font-semibold text-text">{{ alert.stockAtOpen }}</p>
      </div>
      <div>
        <p class="text-xs text-text-muted">{{ $t('alerts.stockMin') }}</p>
        <p class="font-mono font-semibold text-text">{{ alert.stockMin }}</p>
      </div>
    </div>

    <!-- Date -->
    <p class="text-xs text-text-muted">
      {{
        alert.status === 'RESUELTA' && alert.resolvedAt
          ? `${$t('alerts.resolvedAt')}: ${formatDate(alert.resolvedAt)}`
          : `${$t('alerts.openSince')}: ${formatDate(alert.createdAt)}`
      }}
    </p>

    <!-- CTA -->
    <Button v-if="alert.status === 'ACTIVA'" size="sm" @click="goToOrder">
      {{ $t('alerts.createOrder') }}
    </Button>
  </div>
</template>

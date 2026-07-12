<script setup lang="ts">
/**
 * AlertDetailPage — read-only card with product snapshot + resolvedAt if RESUELTA.
 */
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAlertsStore } from '@/stores/alerts';
import AlertBadge from '@/components/atoms/AlertBadge.vue';
import Button from '@/components/atoms/Button.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';

const route = useRoute();
const alerts = useAlertsStore();

onMounted(() => alerts.fetchOne(route.params.id as string));
</script>

<template>
  <div class="py-6 max-w-lg">
    <p class="eyebrow mb-2">P.03.A — DETALLE DE ALERTA</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
    <PageHeader :title="$t('alerts.alertDetail')" />

    <div v-if="alerts.loading" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="alerts.current" class="relative border border-muted rounded-card p-6 bg-card">
      <div
        class="corner-fold"
        :class="{
          'corner-fold--success': alerts.current.status === 'RESUELTA',
          'corner-fold--warning': alerts.current.status === 'ACTIVA',
        }"
        aria-hidden="true"
      />
      <div class="flex items-start justify-between mb-4">
        <p class="font-mono text-xs text-text-muted">{{ alerts.current.productSku }}</p>
        <AlertBadge :status="alerts.current.status" />
      </div>

      <p class="text-lg font-semibold text-text mb-4">{{ alerts.current.productName }}</p>

      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-text-muted text-xs">{{ $t('alerts.stockAtOpen') }}</dt>
          <dd class="font-mono font-semibold text-text">{{ alerts.current.stockAtOpen }}</dd>
        </div>
        <div>
          <dt class="text-text-muted text-xs">{{ $t('alerts.stockMin') }}</dt>
          <dd class="font-mono font-semibold text-text">{{ alerts.current.stockMin }}</dd>
        </div>
        <div>
          <dt class="text-text-muted text-xs">{{ $t('alerts.openSince') }}</dt>
          <dd class="text-text">
            {{ new Date(alerts.current.createdAt).toLocaleDateString('es-CO') }}
          </dd>
        </div>
        <div v-if="alerts.current.resolvedAt">
          <dt class="text-text-muted text-xs">{{ $t('alerts.resolvedAt') }}</dt>
          <dd class="text-text">
            {{ new Date(alerts.current.resolvedAt).toLocaleDateString('es-CO') }}
          </dd>
        </div>
      </dl>

      <Button
        v-if="alerts.current.status === 'ACTIVA'"
        size="sm"
        class="mt-6"
        @click="$router.push({ name: 'order-create', query: { fromAlertId: alerts.current!.id } })"
      >
        {{ $t('alerts.createOrder') }}
      </Button>
    </div>
  </div>
</template>

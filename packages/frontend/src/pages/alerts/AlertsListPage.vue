<script setup lang="ts">
/**
 * AlertsListPage — default status = ACTIVA; embeds AlertCards; CTA "Crear orden".
 */
import { onMounted, ref } from 'vue';
import { useAlertsStore } from '@/stores/alerts';
import AlertCard from '@/components/organisms/AlertCard.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';
import type { AlertStatus } from '@mercadoexpress/shared/primitives/alert-status.js';

const alerts = useAlertsStore();
const statusFilter = ref<AlertStatus | undefined>('ACTIVA');

onMounted(() => {
  alerts.fetchList({ status: statusFilter.value });
});

function setFilter(s: AlertStatus | undefined) {
  statusFilter.value = s;
  alerts.fetchList({ status: s });
}
</script>

<template>
  <div>
    <PageHeader :title="$t('alerts.title')" />

    <!-- Status filter tabs -->
    <div class="flex gap-2 mb-4">
      <button
        v-for="tab in [
          { val: 'ACTIVA' as const, label: $t('alerts.active') },
          { val: 'RESUELTA' as const, label: $t('alerts.resolved') },
          { val: undefined, label: $t('alerts.all') },
        ]"
        :key="String(tab.val)"
        class="px-3 py-1.5 text-sm border rounded-atom transition-all duration-hover"
        :class="
          statusFilter === tab.val
            ? 'border-primary bg-primary text-card font-medium'
            : 'border-muted text-text-muted hover:border-primary'
        "
        @click="setFilter(tab.val)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div
      v-if="alerts.error"
      class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
      role="alert"
    >
      {{ alerts.error }}
    </div>

    <div v-if="alerts.loading" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="alerts.items.length === 0" class="text-center text-text-muted py-12">
      {{ statusFilter === 'ACTIVA' ? $t('alerts.noActiveAlerts') : $t('alerts.noAlerts') }}
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <AlertCard v-for="alert in alerts.items" :key="alert.id" :alert="alert" />
    </div>
  </div>
</template>

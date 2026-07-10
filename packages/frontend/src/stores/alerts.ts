/**
 * Alerts store — MercadoExpress SPA.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as svc from '@/services/alerts';
import type { Alert } from '@/services/alerts';
import type { AlertStatus } from '@mercadoexpress/shared/primitives/alert-status.js';

export const useAlertsStore = defineStore('alerts', () => {
  const items = ref<Alert[]>([]);
  const page = ref(1);
  const total = ref(0);
  const current = ref<Alert | null>(null);
  const statusFilter = ref<AlertStatus | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchList(opts: svc.ListAlertsOptions = {}) {
    loading.value = true;
    error.value = null;
    statusFilter.value = opts.status;
    try {
      const result = await svc.listAlerts(opts);
      items.value = result.items;
      total.value = result.total;
      page.value = result.page;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(id: string) {
    loading.value = true;
    error.value = null;
    try {
      current.value = await svc.getAlert(id);
      return current.value;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function clearError() {
    error.value = null;
  }

  return {
    items,
    page,
    total,
    current,
    statusFilter,
    loading,
    error,
    fetchList,
    fetchOne,
    clearError,
  };
});

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'data' in e) {
    const d = (e as Record<string, unknown>).data as Record<string, string>;
    return d.message ?? 'Error';
  }
  return 'Error';
}

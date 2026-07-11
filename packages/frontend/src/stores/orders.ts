/**
 * Orders store — MercadoExpress SPA.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as svc from '@/services/orders';
import type {
  Order,
  CreateOrderRequest,
  ApproveOrderRequest,
  RejectOrderRequest,
  ReceiveOrderRequest,
} from '@/services/orders';

export const useOrdersStore = defineStore('orders', () => {
  const items = ref<Order[]>([]);
  const page = ref(1);
  const total = ref(0);
  const current = ref<Order | null>(null);
  const statusFilter = ref<string | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchList(opts: svc.ListOrdersOptions = {}) {
    loading.value = true;
    error.value = null;
    statusFilter.value = opts.status;
    try {
      const result = await svc.listOrders(opts);
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
      current.value = await svc.getOrder(id);
      return current.value;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: CreateOrderRequest): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const order = await svc.createOrder(input);
      items.value.unshift(order);
      total.value += 1;
      return order;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function approve(id: string, input: ApproveOrderRequest): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const order = await svc.approveOrder(id, input);
      upsertInList(order);
      if (current.value?.id === id) current.value = order;
      return order;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function reject(id: string, input: RejectOrderRequest): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const order = await svc.rejectOrder(id, input);
      upsertInList(order);
      if (current.value?.id === id) current.value = order;
      return order;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function receive(id: string, input: ReceiveOrderRequest): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const order = await svc.receiveOrder(id, input);
      upsertInList(order);
      if (current.value?.id === id) current.value = order;
      return order;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function upsertInList(order: Order) {
    const idx = items.value.findIndex((o) => o.id === order.id);
    if (idx !== -1) items.value[idx] = order;
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
    create,
    approve,
    reject,
    receive,
    clearError,
  };
});

function extractMessage(e: unknown): string {
  // Backend BC 4xx — ofetch wraps it with { statusCode, data: { code, message } }
  if (typeof e === 'object' && e !== null && 'data' in e) {
    const d = (e as Record<string, unknown>).data as Record<string, string>;
    return d.message ?? 'Error';
  }
  // Zod drift — InvalidOrdersResponseError carries the validation issues.
  if (
    typeof e === 'object' &&
    e !== null &&
    (e as Record<string, unknown>).name === 'InvalidOrdersResponseError'
  ) {
    const err = e as { message?: string; issues?: unknown };
    const issuesCount = Array.isArray(err.issues) ? err.issues.length : 0;
    return (
      err.message ??
      `Error de validación del servidor (${issuesCount} problema${issuesCount !== 1 ? 's' : ''}).`
    );
  }
  return 'Error';
}

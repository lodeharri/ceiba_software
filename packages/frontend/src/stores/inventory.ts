/**
 * Inventory store — MercadoExpress SPA.
 * Movements are keyed by productId (RISK-N04) to avoid cross-product pollution.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as svc from '@/services/inventory';
import type { Movement, CreateMovementRequest } from '@/services/inventory';

export const useInventoryStore = defineStore('inventory', () => {
  // Map<productId, movements[]> — keyed by productId per RISK-N04
  const movementsByProduct = ref<Map<string, Movement[]>>(new Map());
  const currentPage = ref(1);
  const currentSize = ref(50);
  const currentTotal = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchMovements(productId: string, opts: svc.ListMovementsOptions = {}) {
    loading.value = true;
    error.value = null;
    try {
      const result = await svc.listMovements(productId, opts);
      movementsByProduct.value.set(productId, result.items);
      currentPage.value = result.page;
      currentSize.value = result.size;
      currentTotal.value = result.total;
      return result;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function recordMovement(
    productId: string,
    input: CreateMovementRequest,
  ): Promise<Movement> {
    loading.value = true;
    error.value = null;
    try {
      const movement = await svc.recordMovement(productId, input);
      // Prepend to the product's movement list
      const existing = movementsByProduct.value.get(productId) ?? [];
      movementsByProduct.value.set(productId, [movement, ...existing]);
      currentTotal.value += 1;
      return movement;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function getMovementsForProduct(productId: string): Movement[] {
    return movementsByProduct.value.get(productId) ?? [];
  }

  function clearError() {
    error.value = null;
  }

  return {
    movementsByProduct,
    currentPage,
    currentSize,
    currentTotal,
    loading,
    error,
    fetchMovements,
    recordMovement,
    getMovementsForProduct,
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

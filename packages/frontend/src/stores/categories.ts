/**
 * Categories store — MercadoExpress SPA.
 * Categories are read-only in the MVP (no create surface per categories/spec.md).
 * Used primarily by the product form dropdown.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as svc from '@/services/categories';
import type { Category } from '@mercadoexpress/shared/schemas/categories/category.js';

export const useCategoriesStore = defineStore('categories', () => {
  const items = ref<Category[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchList() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await svc.listCategories();
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

  return { items, loading, error, fetchList, clearError };
});

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'data' in e) {
    const d = (e as Record<string, unknown>).data as Record<string, string>;
    return d.message ?? 'Error';
  }
  return 'Error';
}

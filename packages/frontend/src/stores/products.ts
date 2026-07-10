/**
 * Products store — MercadoExpress SPA.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as svc from '@/services/products';
import type { Product, CreateProductRequest, UpdateProductRequest } from '@/services/products';

export const useProductsStore = defineStore('products', () => {
  const items = ref<Product[]>([]);
  const page = ref(1);
  const size = ref(20);
  const total = ref(0);
  const current = ref<Product | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchList(filters: svc.ProductFilters = {}) {
    loading.value = true;
    error.value = null;
    try {
      const result = await svc.listProducts(filters);
      items.value = result.items;
      total.value = result.total;
      page.value = result.page;
      size.value = result.size;
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
      current.value = await svc.getProduct(id);
      return current.value;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: CreateProductRequest): Promise<Product> {
    loading.value = true;
    error.value = null;
    try {
      const product = await svc.createProduct(input);
      items.value.unshift(product);
      total.value += 1;
      return product;
    } catch (e) {
      error.value = extractMessage(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function update(id: string, input: UpdateProductRequest): Promise<Product> {
    loading.value = true;
    error.value = null;
    try {
      const product = await svc.updateProduct(id, input);
      const idx = items.value.findIndex((p) => p.id === id);
      if (idx !== -1) items.value[idx] = product;
      if (current.value?.id === id) current.value = product;
      return product;
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
    size,
    total,
    current,
    loading,
    error,
    fetchList,
    fetchOne,
    create,
    update,
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

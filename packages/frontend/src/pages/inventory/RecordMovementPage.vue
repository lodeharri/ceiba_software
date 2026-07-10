<script setup lang="ts">
/**
 * RecordMovementPage — MovementFormField; submits to useInventoryStore.recordMovement().
 * Returns to product detail on success.
 */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProductsStore } from '@/stores/products';
import { useInventoryStore } from '@/stores/inventory';
import MovementFormField from '@/components/molecules/MovementFormField.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';

const route = useRoute();
const _router = useRouter(); // used in template
const products = useProductsStore();
const inventory = useInventoryStore();

const loading = ref(false);
const error = ref('');

const productId = computed(() => (route.query.productId as string) ?? '');
const product = computed(() => products.items.find((p) => p.id === productId.value));

onMounted(async () => {
  if (!products.items.length) {
    await products.fetchList({ size: 100 });
  }
});

async function handleSubmit(payload: {
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  reason: string;
}) {
  if (!productId.value) {
    error.value = 'Selecciona un producto primero.';
    return;
  }
  error.value = '';
  loading.value = true;
  try {
    await inventory.recordMovement(productId.value, {
      type: payload.type,
      quantity: payload.quantity,
      reason: payload.reason,
    });
    _router.push({ name: 'product-detail', params: { id: productId.value } });
  } catch (e) {
    const err = e as { data?: { message?: string } };
    error.value = err.data?.message ?? 'Error al registrar el movimiento.';
  } finally {
    loading.value = false;
  }
}
</script>

<script lang="ts">
import { computed } from 'vue';
export default { name: 'RecordMovementPage' };
</script>

<template>
  <div class="py-6 max-w-md">
    <PageHeader :title="$t('inventory.recordMovement')" />

    <!-- Product selector (if no productId in query) -->
    <div v-if="!productId" class="mb-4">
      <label for="record-product-select" class="block text-sm font-medium text-text mb-1">
        {{ $t('inventory.filterProduct') }} *
      </label>
      <select
        id="record-product-select"
        class="w-full border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary"
        @change="
          _router.replace({ query: { productId: ($event.target as HTMLSelectElement).value } })
        "
      >
        <option value="" disabled selected>Selecciona un producto</option>
        <option v-for="p in products.items" :key="p.id" :value="p.id">
          {{ p.name }} ({{ p.sku }}) — Stock: {{ p.stock }}
        </option>
      </select>
    </div>

    <div v-if="product" class="mb-4 text-sm text-text-muted">
      <span class="font-mono">{{ product.sku }}</span> — {{ $t('inventory.currentStock') }}:
      <strong class="text-text">{{ product.stock }}</strong>
    </div>

    <div
      v-if="error"
      class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
      role="alert"
    >
      {{ error }}
    </div>

    <div class="border border-muted rounded-card p-6 bg-card">
      <MovementFormField
        v-if="product"
        :current-stock="product?.stock ?? 0"
        :loading="loading"
        @submit="handleSubmit"
      />
      <p v-else class="text-sm text-text-muted text-center py-8">
        Selecciona un producto para continuar.
      </p>
    </div>
  </div>
</template>

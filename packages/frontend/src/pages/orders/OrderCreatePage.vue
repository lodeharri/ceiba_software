<script setup lang="ts">
/**
 * OrderCreatePage — SINGLE FORM (Q-P1), NOT a wizard.
 * productId + quantity + optional fromAlertId (from ?fromAlertId= query).
 * Pre-populates product when ?productId= is present.
 */
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProductsStore } from '@/stores/products';
import { useOrdersStore } from '@/stores/orders';
import Input from '@/components/atoms/Input.vue';
import Button from '@/components/atoms/Button.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';

const route = useRoute();
const router = useRouter();
const products = useProductsStore();
const orders = useOrdersStore();

const selectedProductId = ref('');
const quantity = ref<number | undefined>(undefined);
const error = ref('');
const loading = ref(false);

const fromAlertId = computed(() => (route.query.fromAlertId as string) || undefined);

onMounted(async () => {
  await products.fetchList({ size: 100 });
  if (route.query.productId) {
    selectedProductId.value = route.query.productId as string;
  }
});

const selectedProduct = computed(() =>
  products.items.find((p) => p.id === selectedProductId.value),
);

async function handleSubmit() {
  error.value = '';
  if (!selectedProductId.value) {
    error.value = 'Selecciona un producto.';
    return;
  }
  if (!quantity.value || quantity.value <= 0) {
    error.value = 'La cantidad debe ser mayor que cero.';
    return;
  }
  loading.value = true;
  try {
    await orders.create({
      productId: selectedProductId.value,
      quantity: quantity.value,
      ...(fromAlertId.value ? { fromAlertId: fromAlertId.value } : {}),
    });
    router.push({ name: 'orders-list' });
  } catch (e) {
    const err = e as { data?: { message?: string } };
    error.value = err.data?.message ?? 'Error al crear la orden.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader :title="$t('orders.newOrder')" />

    <div
      v-if="error"
      class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
      role="alert"
    >
      {{ error }}
    </div>

    <form
      class="border border-muted rounded-card p-6 bg-card flex flex-col gap-4"
      @submit.prevent="handleSubmit"
    >
      <!-- From alert info -->
      <div
        v-if="fromAlertId"
        class="px-4 py-3 bg-success/10 border border-success text-success text-sm rounded-atom"
      >
        Creando orden desde alerta activa.
      </div>

      <!-- Product select -->
      <div>
        <label for="order-product" class="block text-sm font-medium text-text mb-1">
          {{ $t('orders.product') }} *
        </label>
        <select
          id="order-product"
          v-model="selectedProductId"
          class="w-full border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary"
        >
          <option value="" disabled>Selecciona un producto</option>
          <option v-for="p in products.items" :key="p.id" :value="p.id">
            {{ p.name }} ({{ p.sku }}) — Stock: {{ p.stock }}
          </option>
        </select>
      </div>

      <!-- Product snapshot -->
      <div
        v-if="selectedProduct"
        class="text-sm text-text-muted border border-muted rounded-atom p-3 bg-surface"
      >
        <p class="font-mono text-xs mb-1">{{ selectedProduct.sku }}</p>
        <p class="font-medium text-text">{{ selectedProduct.name }}</p>
        <p>
          {{ $t('inventory.currentStock') }}: {{ selectedProduct.stock }} ·
          {{ $t('products.supplier') }}: {{ selectedProduct.supplier }}
        </p>
      </div>

      <!-- Quantity -->
      <Input
        id="order-qty"
        v-model="quantity"
        type="number"
        :label="$t('orders.quantity')"
        required
        :min="1"
      />

      <div class="flex gap-3 pt-2">
        <Button type="submit" :loading="loading">
          {{ $t('common.create') }}
        </Button>
        <Button type="button" variant="secondary" @click="router.back()">
          {{ $t('common.cancel') }}
        </Button>
      </div>
    </form>
  </div>
</template>

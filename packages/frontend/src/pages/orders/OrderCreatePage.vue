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
import { useAlertsStore } from '@/stores/alerts';
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
const productLocked = ref(false);
const alertRef = ref<ReturnType<typeof useAlertsStore>['current']>(null);

const fromAlertId = computed(() => (route.query.fromAlertId as string) || undefined);

const alerts = useAlertsStore();

onMounted(async () => {
  await products.fetchList({ size: 100 });
  if (route.query.productId) {
    selectedProductId.value = route.query.productId as string;
  }
  if (fromAlertId.value) {
    const alert = await alerts.fetchOne(fromAlertId.value);
    alertRef.value = alert;
    selectedProductId.value = alert.productId;
    quantity.value = Math.max(1, alert.stockMin * 2);
    productLocked.value = true;
  }
});

const selectedProduct = computed(() =>
  products.items.find((p) => p.id === selectedProductId.value),
);

/** BR-2 / RF-04: minimum orderable quantity is 2x the product's stockMin. */
const minRequiredQuantity = computed(() => (selectedProduct.value?.stockMin ?? 0) * 2);

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
  if (selectedProduct.value && quantity.value < minRequiredQuantity.value) {
    error.value = `La cantidad mínima para este producto es ${minRequiredQuantity.value} unidades (2 veces el stock mínimo = ${selectedProduct.value.stockMin}).`;
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
    const err = e as { data?: { message?: string }; name?: string; message?: string };
    // Backend BC error: { statusCode, data: { code, message } }
    if (err.data?.message) {
      error.value = err.data.message;
    }
    // Zod validation drift: InvalidOrdersResponseError
    else if (err.name === 'InvalidOrdersResponseError') {
      error.value = err.message ?? 'Error de validación del servidor.';
    }
    // Network / unknown
    else {
      error.value = 'Error al crear la orden.';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <p class="eyebrow mb-2 mt-6">P.04.B — NUEVO PEDIDO</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
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

      <!-- Product locked hint (from alert) -->
      <div v-if="productLocked && alertRef" class="text-xs text-text-muted">
        Producto pre-seleccionado desde la alerta #{{ alertRef.id.slice(0, 8) }}
      </div>

      <!-- Product select -->
      <div>
        <label for="order-product" class="block text-sm font-medium text-text mb-1">
          {{ $t('orders.product') }} *
        </label>
        <select
          id="order-product"
          v-model="selectedProductId"
          :disabled="productLocked"
          class="w-full border border-muted bg-card text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary"
          :class="{ 'opacity-60 cursor-not-allowed': productLocked }"
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
      <p
        v-if="selectedProduct && minRequiredQuantity > 0"
        id="order-qty-hint"
        class="text-xs text-text-muted -mt-2"
        data-testid="order-qty-hint"
      >
        Mínimo: {{ minRequiredQuantity }} unidades (política BR-2: 2× stock mínimo).
      </p>

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

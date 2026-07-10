<script setup lang="ts">
/**
 * ProductDetailPage — header card + edit fields + MovementHistoryTable.
 * Default size = 50 per Q-P2.
 */
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProductsStore } from '@/stores/products';
import { useInventoryStore } from '@/stores/inventory';
import { useCategoriesStore } from '@/stores/categories';
import ProductFormField from '@/components/molecules/ProductFormField.vue';
import MovementHistoryTable from '@/components/organisms/MovementHistoryTable.vue';
import Button from '@/components/atoms/Button.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';

const route = useRoute();
const router = useRouter();
const products = useProductsStore();
const inventory = useInventoryStore();
const categories = useCategoriesStore();

const editMode = ref(false);
const loading = ref(false);

const productId = computed(() => route.params.id as string);

const name = ref('');
const price = ref<number | undefined>(undefined);
const stockMin = ref<number | undefined>(undefined);
const supplier = ref('');
const errors = ref<Record<string, string>>({});

onMounted(async () => {
  await Promise.all([
    products.fetchOne(productId.value),
    categories.fetchList(),
    inventory.fetchMovements(productId.value, { size: 50 }),
  ]);
  if (products.current) {
    name.value = products.current.name;
    price.value = Number(products.current.price);
    stockMin.value = products.current.stockMin;
    supplier.value = products.current.supplier;
  }
});

function validate(): boolean {
  errors.value = {};
  if (!name.value.trim()) errors.value.name = 'El nombre es obligatorio.';
  if (price.value === undefined || price.value < 0) errors.value.price = 'Precio inválido.';
  if (stockMin.value === undefined || stockMin.value <= 0)
    errors.value.stockMin = 'Mínimo debe ser > 0.';
  return Object.keys(errors.value).length === 0;
}

async function handleSave() {
  if (!validate()) return;
  loading.value = true;
  try {
    await products.update(productId.value, {
      name: name.value.trim(),
      price: price.value,
      stockMin: stockMin.value!,
      supplier: supplier.value.trim(),
    });
    editMode.value = false;
  } catch {
    // handled by store error
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="py-6">
    <PageHeader :title="$t('products.editProduct')">
      <Button v-if="!editMode" size="sm" variant="secondary" @click="editMode = true">
        {{ $t('common.edit') }}
      </Button>
    </PageHeader>

    <div v-if="products.loading" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="products.current">
      <!-- Product info card -->
      <div class="border border-muted rounded-card p-6 bg-card mb-6">
        <p class="font-mono text-xs text-text-muted mb-4">{{ products.current.sku }}</p>

        <div v-if="!editMode" class="flex flex-col gap-3 text-sm">
          <p>
            <span class="font-medium text-text-muted">Nombre:</span> {{ products.current.name }}
          </p>
          <p>
            <span class="font-medium text-text-muted">Precio:</span> COP
            {{ Number(products.current.price).toLocaleString('es-CO') }}
          </p>
          <p>
            <span class="font-medium text-text-muted">Stock:</span> {{ products.current.stock }}
          </p>
          <p>
            <span class="font-medium text-text-muted">Stock mínimo:</span>
            {{ products.current.stockMin }}
          </p>
          <p>
            <span class="font-medium text-text-muted">Proveedor:</span>
            {{ products.current.supplier }}
          </p>
          <p>
            <span class="font-medium text-text-muted">Creado:</span>
            {{ new Date(products.current.createdAt).toLocaleDateString('es-CO') }}
          </p>
        </div>

        <form v-else class="flex flex-col gap-4" @submit.prevent="handleSave">
          <ProductFormField
            v-model="name"
            label="Nombre"
            field="name"
            :error="errors.name"
            required
          />
          <div class="grid grid-cols-2 gap-4">
            <ProductFormField
              v-model="price"
              label="Precio (COP)"
              field="price"
              :error="errors.price"
              :min="0"
            />
            <ProductFormField
              v-model="stockMin"
              label="Stock mínimo"
              field="stockMin"
              :error="errors.stockMin"
              :min="1"
            />
          </div>
          <ProductFormField v-model="supplier" label="Proveedor" field="supplier" />
          <div class="flex gap-3 pt-2">
            <Button type="submit" :loading="loading">{{ $t('common.save') }}</Button>
            <Button type="button" variant="secondary" @click="editMode = false">
              {{ $t('common.cancel') }}
            </Button>
          </div>
        </form>
      </div>

      <!-- Movement history -->
      <h2 class="text-lg font-semibold text-text mb-3">{{ $t('inventory.title') }}</h2>
      <MovementHistoryTable
        :movements="inventory.getMovementsForProduct(productId)"
        :loading="inventory.loading"
        :page="inventory.currentPage"
        :size="inventory.currentSize"
        :total="inventory.currentTotal"
      />

      <div class="mt-4">
        <Button
          size="sm"
          variant="secondary"
          @click="router.push({ name: 'movement-create', query: { productId } })"
        >
          + {{ $t('inventory.recordMovement') }}
        </Button>
      </div>
    </template>

    <div v-else class="text-center text-text-muted py-12">
      {{ $t('products.productNotFound') }}
    </div>
  </div>
</template>

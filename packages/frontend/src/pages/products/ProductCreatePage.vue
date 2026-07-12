<script setup lang="ts">
/**
 * ProductCreatePage — form with ProductFormFields, category select.
 * SKU uniqueness surfaced as inline error.
 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProductsStore } from '@/stores/products';
import { useCategoriesStore } from '@/stores/categories';
import ProductFormField from '@/components/molecules/ProductFormField.vue';
import Button from '@/components/atoms/Button.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';

const router = useRouter();
const products = useProductsStore();
const categories = useCategoriesStore();

const sku = ref('');
const name = ref('');
const price = ref<number | undefined>(undefined);
const stock = ref<number | undefined>(undefined);
const stockMin = ref<number | undefined>(undefined);
const supplier = ref('');
const categoryId = ref('');
const errors = ref<Record<string, string>>({});
const loading = ref(false);
const serverError = ref('');

onMounted(() => categories.fetchList());

function validate(): boolean {
  errors.value = {};
  if (!sku.value.trim()) errors.value.sku = 'El SKU es obligatorio.';
  if (sku.value.length < 6) errors.value.sku = 'El SKU debe tener al menos 6 caracteres.';
  if (!name.value.trim()) errors.value.name = 'El nombre es obligatorio.';
  if (price.value === undefined || price.value <= 0)
    errors.value.price = 'El precio debe ser mayor que cero.';
  if (stock.value === undefined || stock.value < 0) errors.value.stock = 'El stock es obligatorio.';
  if (stockMin.value === undefined || stockMin.value <= 0)
    errors.value.stockMin = 'El stock mínimo debe ser mayor que cero.';
  if (!supplier.value.trim()) errors.value.supplier = 'El proveedor es obligatorio.';
  if (!categoryId.value) errors.value.categoryId = 'La categoría es obligatoria.';
  return Object.keys(errors.value).length === 0;
}

async function handleSubmit() {
  serverError.value = '';
  if (!validate()) return;
  loading.value = true;
  try {
    await products.create({
      sku: sku.value.trim(),
      name: name.value.trim(),
      price: price.value!,
      stock: stock.value ?? 0,
      stockMin: stockMin.value!,
      supplier: supplier.value.trim(),
      categoryId: categoryId.value,
    });
    router.push({ name: 'products-list' });
  } catch (e) {
    const err = e as { data?: { message?: string } };
    const msg = err.data?.message ?? '';
    if (msg.includes('SKU')) {
      errors.value.sku = 'Ya existe un producto con este SKU.';
    } else {
      serverError.value = msg || 'Error al crear el producto.';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="py-6 max-w-lg">
    <p class="eyebrow mb-2">P.01.B — NUEVO PRODUCTO</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
    <PageHeader :title="$t('products.createProduct')" />

    <div
      v-if="serverError"
      class="mb-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
      role="alert"
    >
      {{ serverError }}
    </div>

    <form
      class="flex flex-col gap-4 border border-muted rounded-card p-6 bg-card"
      @submit.prevent="handleSubmit"
    >
      <ProductFormField v-model="sku" label="SKU" field="sku" :error="errors.sku" required />
      <ProductFormField v-model="name" label="Nombre" field="name" :error="errors.name" required />
      <div>
        <label for="create-category" class="block text-sm font-medium text-text mb-1">
          {{ $t('products.category') }} *
        </label>
        <select
          id="create-category"
          v-model="categoryId"
          class="w-full border border-muted bg-card text-text px-3 py-2 text-sm rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1"
          :class="errors.categoryId ? 'border-danger' : ''"
        >
          <option value="" disabled>Selecciona una categoría</option>
          <option v-for="cat in categories.items" :key="cat.id" :value="cat.id">
            {{ cat.name }}
          </option>
        </select>
        <p v-if="errors.categoryId" class="text-xs text-danger mt-1">{{ errors.categoryId }}</p>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <ProductFormField
          v-model="price"
          label="Precio (COP)"
          field="price"
          :error="errors.price"
          required
          :min="0"
        />
        <ProductFormField
          v-model="stock"
          label="Stock inicial"
          field="stock"
          :error="errors.stock"
          required
          :min="0"
        />
      </div>
      <ProductFormField
        v-model="stockMin"
        label="Stock mínimo"
        field="stockMin"
        :error="errors.stockMin"
        required
        :min="1"
      />
      <ProductFormField
        v-model="supplier"
        label="Proveedor"
        field="supplier"
        :error="errors.supplier"
        required
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

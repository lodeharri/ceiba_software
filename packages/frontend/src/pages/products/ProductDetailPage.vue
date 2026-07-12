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

/**
 * Stock band — per RF-03 + the status split we shipped for StockTable:
 *  stock === 0                              -> 'out'  (Sin stock)
 *  0 < stock <= stockMin                    -> 'low'  (Stock bajo — alerta activa)
 *  stockMin < stock <= 2*stockMin           -> 'warn' (Cerca del mínimo)
 *  otherwise                                -> 'ok'   (Stock OK)
 */
const stockBand = computed(() => {
  const p = products.current;
  if (!p) return null;
  if (p.stock === 0) return 'out' as const;
  if (p.stock <= p.stockMin) return 'low' as const;
  if (p.stock <= p.stockMin * 2) return 'warn' as const;
  return 'ok' as const;
});

const stockBandLabel = computed(() => {
  switch (stockBand.value) {
    case 'out':
      return 'Sin stock';
    case 'low':
      return 'Stock bajo';
    case 'warn':
      return 'Cerca del mínimo';
    case 'ok':
      return 'Stock OK';
    default:
      return '';
  }
});

const stockBandClass = computed(() => {
  switch (stockBand.value) {
    case 'out':
      return 'bg-danger/10 text-danger';
    case 'low':
      return 'bg-warning/10 text-warning';
    case 'warn':
      return 'bg-warning/5 text-text-muted';
    default:
      return 'bg-success/10 text-success';
  }
});

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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' }).format(new Date(iso));
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
    <p class="eyebrow mb-2">P.01.A — DETALLE DE PRODUCTO</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
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
      <div class="relative border border-muted rounded-card p-6 bg-card mb-6">
        <div
          class="corner-fold"
          :class="{
            'corner-fold--success': stockBand === 'ok',
            'corner-fold--warning': stockBand === 'warn' || stockBand === 'low',
            'corner-fold--danger': stockBand === 'out',
          }"
          aria-hidden="true"
        />
        <p class="font-mono text-xs text-text-muted mb-4">{{ products.current.sku }}</p>

        <!-- Stat cards: per frontend-design, a stat-grid pairs a small uppercase
                 label with a large value — the operator scans numbers, not paragraphs. -->
        <div v-if="!editMode" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <!-- Stock gets a coloured band so the operator sees alert state at a glance. -->
          <div
            class="rounded-card p-3 border"
            :class="[
              stockBand === 'out' && 'border-danger',
              stockBand === 'low' && 'border-warning',
              stockBand !== 'out' && stockBand !== 'low' && 'border-muted',
            ]"
            data-testid="stat-stock"
          >
            <p class="text-[10px] uppercase tracking-wide text-text-muted font-medium">Stock</p>
            <p class="hero-number text-2xl mt-0.5">{{ products.current.stock }}</p>
            <p class="text-xs mt-1">
              <span
                class="inline-block px-1.5 py-0.5 rounded-atom text-[10px] font-medium"
                :class="stockBandClass"
              >
                {{ stockBandLabel }}
              </span>
            </p>
          </div>

          <div class="rounded-card p-3 border border-muted" data-testid="stat-price">
            <p class="text-[10px] uppercase tracking-wide text-text-muted font-medium">Precio</p>
            <p class="hero-number text-2xl mt-0.5">
              ${{ Number(products.current.price).toLocaleString('es-CO') }}
            </p>
            <p class="text-xs text-text-muted mt-1">COP</p>
          </div>

          <div class="rounded-card p-3 border border-muted" data-testid="stat-stockmin">
            <p class="text-[10px] uppercase tracking-wide text-text-muted font-medium">
              Stock mínimo
            </p>
            <p class="hero-number text-2xl mt-0.5">{{ products.current.stockMin }}</p>
            <p class="text-xs text-text-muted mt-1">umbral de alerta</p>
          </div>

          <div class="rounded-card p-3 border border-muted col-span-2 md:col-span-1">
            <p class="text-[10px] uppercase tracking-wide text-text-muted font-medium">Proveedor</p>
            <p class="text-base font-medium mt-0.5 truncate" :title="products.current.supplier">
              {{ products.current.supplier }}
            </p>
            <p class="text-xs text-text-muted mt-1">actualizado al crear la orden</p>
          </div>
        </div>

        <!-- Secondary info: flat list, smaller. -->
        <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm pt-3 border-t border-muted">
          <div>
            <dt class="text-text-muted text-xs">Nombre</dt>
            <dd class="text-text font-medium">{{ products.current.name }}</dd>
          </div>
          <div>
            <dt class="text-text-muted text-xs">SKU</dt>
            <dd class="text-text font-mono text-xs">{{ products.current.sku }}</dd>
          </div>
          <div>
            <dt class="text-text-muted text-xs">Creado</dt>
            <dd class="text-text">{{ formatDate(products.current.createdAt) }}</dd>
          </div>
        </dl>

        <form v-if="editMode" class="flex flex-col gap-4" @submit.prevent="handleSave">
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

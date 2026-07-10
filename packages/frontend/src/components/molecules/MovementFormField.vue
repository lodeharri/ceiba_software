<script setup lang="ts">
/**
 * MovementFormField — ENTRADA/SALIDA radio + quantity + reason.
 * Includes client-side stock-availability check (SALIDA cannot exceed currentStock).
 */
import { ref, computed } from 'vue';
import Input from '@/components/atoms/Input.vue';
import Button from '@/components/atoms/Button.vue';

interface Props {
  currentStock?: number;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  currentStock: 0,
  loading: false,
});

const type = ref<'ENTRADA' | 'SALIDA'>('ENTRADA');
const quantity = ref<number | undefined>(undefined);
const reason = ref('');
const quantityError = ref('');

const emit = defineEmits<{
  (e: 'submit', payload: { type: 'ENTRADA' | 'SALIDA'; quantity: number; reason: string }): void;
}>();

function validate(): boolean {
  quantityError.value = '';
  if (!quantity.value || quantity.value <= 0) {
    quantityError.value = 'La cantidad debe ser mayor que cero.';
    return false;
  }
  if (type.value === 'SALIDA' && quantity.value > (props.currentStock ?? 0)) {
    quantityError.value = `No hay suficiente stock. Disponible: ${props.currentStock}`;
    return false;
  }
  if (!reason.value.trim()) {
    return false;
  }
  return true;
}

function handleSubmit() {
  if (!validate()) return;
  emit('submit', {
    type: type.value,
    quantity: quantity.value!,
    reason: reason.value.trim(),
  });
}

const stockAfter = computed(() => {
  if (!quantity.value) return props.currentStock;
  return type.value === 'ENTRADA'
    ? (props.currentStock ?? 0) + quantity.value
    : (props.currentStock ?? 0) - quantity.value;
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Type radio -->
    <fieldset>
      <legend class="text-sm font-medium text-text mb-2">Tipo de movimiento</legend>
      <div class="flex gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="type" type="radio" value="ENTRADA" class="accent-primary" />
          <span class="text-sm text-text">Entrada</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="type" type="radio" value="SALIDA" class="accent-primary" />
          <span class="text-sm text-text">Salida</span>
        </label>
      </div>
    </fieldset>

    <!-- Quantity -->
    <Input
      id="movement-qty"
      type="number"
      :label="$t('inventory.quantity')"
      :model-value="quantity"
      :error="quantityError"
      required
      :min="1"
      @update:model-value="quantity = Number($event)"
    />

    <!-- Reason -->
    <div class="flex flex-col gap-1">
      <label for="movement-reason" class="text-sm font-medium text-text">
        {{ $t('inventory.reason') }} *
      </label>
      <textarea
        id="movement-reason"
        v-model="reason"
        rows="2"
        maxlength="280"
        class="w-full border border-muted bg-card text-text px-3 py-2 text-sm rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 placeholder:text-text-muted resize-none transition-all duration-hover ease-out"
        :placeholder="$t('inventory.reason')"
      />
    </div>

    <!-- Stock preview -->
    <p v-if="quantity" class="text-sm text-text-muted font-mono">
      {{ $t('inventory.newStock') }}:
      <span class="font-semibold text-text">{{ stockAfter }}</span>
    </p>

    <!-- Submit -->
    <Button type="submit" :loading="loading" @click.prevent="handleSubmit">
      {{ $t('inventory.recordMovement') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
/**
 * ProductFormField — label + input + inline error for product fields.
 * Wraps the Input atom (design.md §8.9 — every input has a label, not just placeholder).
 */
import Input from '@/components/atoms/Input.vue';

interface Props {
  modelValue?: string | number;
  label: string;
  field: string; // e.g. 'sku', 'name', 'price', 'stock', 'stockMin', 'supplier'
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  required: false,
  disabled: false,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: string | number): void }>();

const fieldToType: Record<string, 'text' | 'number'> = {
  price: 'number',
  stock: 'number',
  stockMin: 'number',
};
</script>

<template>
  <Input
    :id="`field-${field}`"
    :type="fieldToType[field] ?? 'text'"
    :label="label"
    :model-value="modelValue"
    :error="error"
    :required="required"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>

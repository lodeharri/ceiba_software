<script setup lang="ts">
interface Props {
  modelValue?: string | number;
  label?: string;
  type?: 'text' | 'number' | 'password' | 'email';
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  min?: number;
  max?: number;
}

withDefaults(defineProps<Props>(), {
  type: 'text',
  modelValue: '',
  required: false,
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
}>();

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = target.type === 'number' ? Number(target.value) : target.value;
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" :for="id" class="text-sm font-medium text-text">
      {{ label }}
      <span v-if="required" class="text-danger ml-0.5" aria-hidden="true">*</span>
    </label>
    <input
      :id="id"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :min="min"
      :max="max"
      :aria-invalid="!!error"
      :aria-describedby="error ? `${id}-error` : undefined"
      class="w-full border border-muted bg-card text-text px-3 py-2 text-sm rounded-atom placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-hover ease-out"
      :class="error ? 'border-danger focus:border-danger focus:ring-danger' : ''"
      @input="handleInput"
    />
    <p v-if="error" :id="`${id}-error`" class="text-xs text-danger" role="alert">
      {{ error }}
    </p>
  </div>
</template>

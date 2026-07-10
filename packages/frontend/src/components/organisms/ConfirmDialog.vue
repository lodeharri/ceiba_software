<script setup lang="ts">
/**
 * ConfirmDialog — reusable confirmation modal.
 * Used for reject (requires ≥10-char reason) and receive (simple confirm).
 */
import { ref, watch } from 'vue';
import Button from '@/components/atoms/Button.vue';

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  confirmLabel: 'Confirmar',
  cancelLabel: 'Cancelar',
  requireReason: false,
  loading: false,
});

const emit = defineEmits<{
  (e: 'confirm', reason?: string): void;
  (e: 'cancel'): void;
}>();

const reason = ref('');

watch(
  () => props.open,
  (val) => {
    if (!val) reason.value = '';
  },
);

function confirm() {
  if (props.requireReason && reason.value.trim().length < 10) return;
  emit('confirm', reason.value.trim() || undefined);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'dialog-title'"
    >
      <div
        class="bg-card border border-muted rounded-modal p-6 shadow-lg w-full max-w-sm mx-4 animate-[fade-in_200ms_ease-out]"
      >
        <h2 id="dialog-title" class="text-base font-semibold text-text mb-2">
          {{ title }}
        </h2>
        <p v-if="body" class="text-sm text-text-muted mb-4">{{ body }}</p>

        <!-- Rejection reason input -->
        <div v-if="requireReason" class="mb-4">
          <label for="dialog-reason" class="block text-sm font-medium text-text mb-1">
            {{ $t('orders.rejectionReason') }} *
          </label>
          <textarea
            id="dialog-reason"
            v-model="reason"
            rows="3"
            maxlength="500"
            class="w-full border border-muted bg-surface text-text text-sm px-3 py-2 rounded-atom focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 resize-none transition-all duration-hover"
            :placeholder="reasonPlaceholder ?? $t('orders.rejectionReasonPlaceholder')"
          />
          <p
            v-if="requireReason && reason.trim().length > 0 && reason.trim().length < 10"
            class="text-xs text-danger mt-1"
          >
            {{ $t('orders.rejectionReasonTooShort') }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-3">
          <Button variant="secondary" size="sm" @click="emit('cancel')">
            {{ cancelLabel }}
          </Button>
          <Button
            variant="danger"
            size="sm"
            :loading="loading"
            :disabled="requireReason && reason.trim().length < 10"
            @click="confirm"
          >
            {{ confirmLabel }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

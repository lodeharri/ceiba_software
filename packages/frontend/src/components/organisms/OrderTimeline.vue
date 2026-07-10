<script setup lang="ts">
/**
 * OrderTimeline — vertical stepper for PENDIENTE → APROBADA → RECIBIDA / RECHAZADA.
 * Action buttons rendered ONLY when current status allows the transition
 * (BR-5 state machine + BR-D1..BR-D3).
 */
import { computed } from 'vue';
import Button from '@/components/atoms/Button.vue';
import type { Order } from '@/services/orders';
import type { OrderStatus } from '@mercadoexpress/shared/primitives/order-status.js';

interface Props {
  order: Order;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), { loading: false });

const emit = defineEmits<{
  (e: 'approve'): void;
  (e: 'reject'): void;
  (e: 'receive'): void;
}>();

const statusOrder: OrderStatus[] = ['PENDIENTE', 'APROBADA', 'RECIBIDA'];
const currentIdx = computed(() => statusOrder.indexOf(props.order.status as OrderStatus));

const steps = computed(() =>
  statusOrder.map((s, i) => ({
    label: s,
    done: i < currentIdx.value,
    active: i === currentIdx.value,
    rejected: props.order.status === 'RECHAZADA' && i === 1,
  })),
);

const canApprove = computed(() => props.order.status === 'PENDIENTE');
const canReject = computed(() => props.order.status === 'PENDIENTE');
const canReceive = computed(() => props.order.status === 'APROBADA');

const labelKey: Record<string, string> = {
  PENDIENTE: 'orders.pending',
  APROBADA: 'orders.approved',
  RECIBIDA: 'orders.received',
};
</script>

<template>
  <div class="flex flex-col gap-0">
    <!-- Steps -->
    <div v-for="(step, i) in steps" :key="step.label" class="flex items-start gap-3">
      <!-- Connector line -->
      <div
        v-if="i > 0"
        class="w-px h-4 ml-1.5"
        :class="step.done || step.rejected ? 'bg-success' : 'bg-muted'"
      />

      <!-- Step indicator -->
      <div class="flex flex-col items-center">
        <div
          class="w-3 h-3 rounded-full border-2 flex-shrink-0 mt-1"
          :class="
            step.done
              ? 'border-success bg-success'
              : step.rejected
                ? 'border-danger bg-danger'
                : step.active
                  ? 'border-primary bg-primary'
                  : 'border-muted bg-card'
          "
        />
      </div>

      <!-- Label -->
      <div class="pb-4">
        <p
          class="text-sm font-medium"
          :class="
            step.done || step.rejected
              ? 'text-success'
              : step.active
                ? 'text-text'
                : 'text-text-muted'
          "
        >
          {{ $t(labelKey[step.label] ?? step.label) }}
        </p>
        <p
          v-if="step.label === 'RECHAZADA' && order.status === 'RECHAZADA'"
          class="text-xs text-danger mt-1"
        >
          {{ order.rejectionReason }}
        </p>
        <p
          v-if="step.label === 'RECIBIDA' && order.status === 'RECIBIDA'"
          class="text-xs text-success mt-1"
        >
          {{ $t('orders.receivedAt') }}:
          {{ new Date(order.receivedAt!).toLocaleDateString('es-CO') }}
        </p>
      </div>
    </div>

    <!-- Rejection reason if rejected -->
    <div v-if="order.status === 'RECHAZADA'" class="mt-2">
      <p class="text-xs text-text-muted">{{ $t('orders.rejectionReason') }}:</p>
      <p class="text-sm text-danger">{{ order.rejectionReason }}</p>
    </div>

    <!-- Action buttons — gated by state machine -->
    <div class="flex gap-3 mt-4">
      <Button
        v-if="canApprove"
        variant="primary"
        size="sm"
        :loading="loading"
        @click="emit('approve')"
      >
        {{ $t('orders.approve') }}
      </Button>
      <Button
        v-if="canReject"
        variant="danger"
        size="sm"
        :loading="loading"
        @click="emit('reject')"
      >
        {{ $t('orders.reject') }}
      </Button>
      <Button
        v-if="canReceive"
        variant="primary"
        size="sm"
        :loading="loading"
        @click="emit('receive')"
      >
        {{ $t('orders.receive') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * OrderDetailPage — OrderTimeline + ConfirmDialog for reject and receive.
 * Action buttons rendered only when current status allows transition
 * (BR-5 + BR-D1..BR-D3).
 */
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useOrdersStore } from '@/stores/orders';
import OrderTimeline from '@/components/organisms/OrderTimeline.vue';
import ConfirmDialog from '@/components/organisms/ConfirmDialog.vue';
import PageHeader from '@/components/molecules/PageHeader.vue';

const route = useRoute();
const orders = useOrdersStore();

const showRejectDialog = ref(false);
const showReceiveDialog = ref(false);
const loading = ref(false);

onMounted(() => orders.fetchOne(route.params.id as string));

async function handleApprove() {
  loading.value = true;
  try {
    await orders.approve(route.params.id as string, {});
  } catch {
    // handled by store
  } finally {
    loading.value = false;
  }
}

async function handleRejectConfirm(reason?: string) {
  showRejectDialog.value = false;
  loading.value = true;
  try {
    await orders.reject(route.params.id as string, { reason: reason ?? '' });
  } catch {
    // handled by store
  } finally {
    loading.value = false;
  }
}

async function handleReceiveConfirm() {
  showReceiveDialog.value = false;
  loading.value = true;
  try {
    await orders.receive(route.params.id as string, {});
  } catch {
    // handled by store
  } finally {
    loading.value = false;
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
</script>

<template>
  <div class="py-6 max-w-lg">
    <PageHeader :title="$t('orders.orderDetail')" />

    <div v-if="orders.loading && !orders.current" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="orders.current">
      <div class="border border-muted rounded-card p-6 bg-card mb-6">
        <p class="font-mono text-xs text-text-muted mb-3">{{ orders.current.id }}</p>

        <!-- Product info -->
        <div class="flex items-start justify-between mb-4">
          <div>
            <p class="font-semibold text-text">{{ orders.current.productName }}</p>
            <p class="text-sm text-text-muted font-mono">{{ orders.current.productSku }}</p>
          </div>
          <span class="text-2xl font-mono font-bold text-text">{{ orders.current.quantity }}</span>
        </div>

        <dl class="grid grid-cols-2 gap-3 text-sm mb-6">
          <div>
            <dt class="text-text-muted text-xs">{{ $t('orders.supplierSnapshot') }}</dt>
            <dd class="text-text font-medium">{{ orders.current.supplierSnapshot }}</dd>
          </div>
          <div>
            <dt class="text-text-muted text-xs">{{ $t('orders.createdAt') }}</dt>
            <dd class="text-text">{{ formatDate(orders.current.createdAt) }}</dd>
          </div>
        </dl>

        <!-- State machine timeline -->
        <h3 class="text-sm font-medium text-text-muted mb-3">{{ $t('common.status') }}</h3>
        <OrderTimeline
          :order="orders.current"
          :loading="loading"
          @approve="handleApprove"
          @reject="showRejectDialog = true"
          @receive="showReceiveDialog = true"
        />
      </div>
    </template>

    <!-- Confirm dialogs -->
    <ConfirmDialog
      :open="showRejectDialog"
      :title="$t('confirm.rejectTitle')"
      :body="$t('confirm.rejectBody')"
      :confirm-label="$t('orders.reject')"
      :require-reason="true"
      :reason-placeholder="$t('orders.rejectionReasonPlaceholder')"
      :loading="loading"
      @confirm="handleRejectConfirm"
      @cancel="showRejectDialog = false"
    />

    <ConfirmDialog
      :open="showReceiveDialog"
      :title="$t('confirm.receiveTitle')"
      :body="$t('confirm.receiveBody')"
      :confirm-label="$t('orders.receive')"
      :loading="loading"
      @confirm="handleReceiveConfirm"
      @cancel="showReceiveDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * CategoriesListPage — lookup list with inline create (RF-01 support).
 */
import { onMounted, ref } from 'vue';
import { useCategoriesStore } from '@/stores/categories';
import PageHeader from '@/components/molecules/PageHeader.vue';
import Button from '@/components/atoms/Button.vue';
import EmptyState from '@/components/molecules/EmptyState.vue';

const categories = useCategoriesStore();

const showForm = ref(false);
const newName = ref('');
const formError = ref<string | null>(null);
const submitting = ref(false);

onMounted(() => categories.fetchList());

function openForm() {
  showForm.value = true;
  newName.value = '';
  formError.value = null;
}

function cancelForm() {
  showForm.value = false;
  newName.value = '';
  formError.value = null;
}

async function submitForm() {
  const name = newName.value.trim();
  if (!name) {
    formError.value = 'El nombre no puede estar vacío.';
    return;
  }
  submitting.value = true;
  formError.value = null;
  try {
    await categories.create(name);
    cancelForm();
  } catch (e) {
    formError.value = extractMessage(e);
  } finally {
    submitting.value = false;
  }
}

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'data' in e) {
    const d = (e as Record<string, unknown>).data as Record<string, string>;
    return d.message ?? 'Error';
  }
  return 'Error';
}
</script>

<template>
  <div>
    <p class="eyebrow mb-2 mt-6">P.05 — CATEGORÍAS</p>
    <div class="section-hairline mb-4" />
    <div class="section-rule mb-3" />
    <PageHeader :title="$t('categories.title')">
      <Button v-if="!showForm" size="sm" @click="openForm">
        + {{ $t('categories.createCategory') }}
      </Button>
    </PageHeader>

    <!-- Create form -->
    <div v-if="showForm" class="mt-4 p-4 border border-muted rounded-card bg-card space-y-3">
      <div>
        <label for="cat-name" class="block text-sm font-medium text-text mb-1">
          {{ $t('categories.name') }}
        </label>
        <input
          id="cat-name"
          v-model="newName"
          type="text"
          data-testid="category-name-input"
          class="w-full px-3 py-2 border border-muted rounded-input bg-background text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          :disabled="submitting"
          @keyup.enter="submitForm"
          @keyup.esc="cancelForm"
        />
        <p v-if="formError" class="mt-1 text-xs text-danger">{{ formError }}</p>
      </div>
      <div class="flex gap-2">
        <Button
          size="sm"
          data-testid="category-submit-btn"
          :disabled="submitting"
          @click="submitForm"
        >
          {{ $t('common.save') }}
        </Button>
        <Button size="sm" variant="secondary" :disabled="submitting" @click="cancelForm">
          {{ $t('common.cancel') }}
        </Button>
      </div>
    </div>

    <!-- Error banner -->
    <div
      v-if="categories.error"
      class="mt-4 px-4 py-3 bg-danger/10 border border-danger text-danger text-sm rounded-card"
      role="alert"
      data-testid="categories-error-banner"
    >
      {{ categories.error }}
    </div>

    <div v-if="categories.loading" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <div
      v-else-if="!categories.loading && categories.items.length === 0 && !categories.error"
      class="mt-4"
    >
      <EmptyState :message="$t('empty.categories')">
        <template #action>
          <Button size="sm" @click="openForm"> + {{ $t('categories.createCategory') }} </Button>
        </template>
      </EmptyState>
    </div>

    <div v-else class="border border-muted rounded-card overflow-hidden bg-card mt-4">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-muted">
            <th class="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">
              {{ $t('categories.name') }}
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">
              {{ $t('common.createdAt') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="cat in categories.items"
            :key="cat.id"
            class="border-b border-muted last:border-0"
            style="height: 48px"
          >
            <td class="px-4 py-3 text-text font-medium">{{ cat.name }}</td>
            <td class="px-4 py-3 text-text-muted text-xs">
              {{
                new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' }).format(
                  new Date(cat.createdAt),
                )
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

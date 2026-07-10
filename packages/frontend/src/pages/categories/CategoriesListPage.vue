<script setup lang="ts">
/**
 * CategoriesListPage — lookup list (RF-01 support).
 * No UI creation surface per categories/spec.md.
 */
import { onMounted } from 'vue';
import { useCategoriesStore } from '@/stores/categories';
import PageHeader from '@/components/molecules/PageHeader.vue';

const categories = useCategoriesStore();
onMounted(() => categories.fetchList());
</script>

<template>
  <div>
    <PageHeader :title="$t('categories.title')" />

    <div v-if="categories.loading" class="text-center text-text-muted py-12">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="categories.items.length === 0" class="text-center text-text-muted py-12">
      {{ $t('categories.noCategories') }}
    </div>

    <div v-else class="border border-muted rounded-card overflow-hidden bg-card">
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

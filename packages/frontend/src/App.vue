<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import DashboardLayout from '@/templates/DashboardLayout.vue';
import AuthLayout from '@/templates/AuthLayout.vue';

const route = useRoute();

const layout = computed(() => {
  const l = route.meta.layout as string | undefined;
  if (l === 'auth') return AuthLayout;
  return DashboardLayout;
});
</script>

<template>
  <component :is="layout">
    <RouterView />
  </component>
</template>

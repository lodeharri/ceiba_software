<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<template>
  <div class="text-center">
    <p class="text-6xl font-bold font-mono text-muted mb-4">404</p>
    <h2 class="text-lg font-semibold text-text mb-2">Página no encontrada</h2>
    <p class="text-sm text-text-muted mb-6">La página que buscas no existe.</p>
    <button
      class="px-4 py-2 border border-primary bg-primary text-card text-sm rounded-atom hover:bg-primary-hover transition-all duration-hover"
      @click="router.push('/')"
    >
      Volver al inicio
    </button>
  </div>
</template>

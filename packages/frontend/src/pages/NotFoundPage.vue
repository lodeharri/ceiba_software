<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<template>
  <div class="text-center py-4">
    <!-- Eyebrow: ledger position marker -->
    <p class="eyebrow mb-3">P.404 — ERROR</p>
    <div class="section-hairline mb-6" />

    <!-- Big stamp: 404 as a tilted handwritten-style seal -->
    <div class="relative inline-block mb-6 select-none">
      <!-- Outer border ring -->
      <div
        aria-hidden="true"
        class="absolute inset-0 border-2 border-danger"
        style="transform: rotate(-6deg) scale(1.18); border-radius: 50%; opacity: 0.85"
      />
      <!-- 404 number -->
      <p
        class="hero-number relative"
        style="
          font-size: 96px;
          line-height: 1;
          color: var(--color-danger);
          transform: rotate(-6deg);
          padding: 16px 28px;
        "
      >
        404
      </p>
    </div>

    <!-- Handwritten-style manuscript label -->
    <div class="inline-block mb-6">
      <p
        class="font-mono text-sm text-text"
        style="
          font-style: italic;
          letter-spacing: 0.04em;
          border-bottom: 2px solid var(--color-muted);
          padding-bottom: 2px;
        "
      >
        no encontramos esta página
      </p>
    </div>

    <p class="text-sm text-text-muted mb-6">
      La ruta que seguiste no apunta a ningún lugar del cuaderno.
    </p>

    <button
      class="px-4 py-2 border border-primary bg-primary text-card text-sm rounded-atom hover:bg-primary-hover transition-all duration-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      @click="router.push('/')"
    >
      Volver al inicio
    </button>
  </div>
</template>

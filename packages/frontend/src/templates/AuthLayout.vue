<script setup lang="ts">
/**
 * AuthLayout — centered card, no nav (design.md §8).
 * Used for LoginPage and NotFoundPage.
 */
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface px-4">
    <div class="w-full max-w-sm">
      <!-- Brand mark -->
      <div class="flex flex-col items-center mb-8">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          class="text-primary mb-3"
        >
          <path
            d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path d="M9 22V12h6v10" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        </svg>
        <h1 class="text-xl font-semibold text-text">{{ $t('app.name') }}</h1>
      </div>

      <!-- Card -->
      <div class="border border-muted rounded-card bg-card p-6 shadow-sm">
        <slot />
      </div>
    </div>
  </div>
</template>

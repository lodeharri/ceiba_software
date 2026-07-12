<script setup lang="ts">
/**
 * AuthLayout — centered card, no nav (design.md §8).
 * Used for LoginPage and NotFoundPage.
 *
 * Visual refresh (pasada 2):
 *  - Surface reads as warm paper (background-color + soft top gradient
 *    so the paper feel is visible behind the card).
 *  - Brand mark is rendered as a "hanging tag" with a notch cut in the
 *    bottom — rotated slightly so it reads as a pinned label.
 *  - Form labels inside <slot /> are styled mono uppercase via .eyebrow
 *    when slotted pages opt-in (the Label component is not modified).
 */
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface px-4 py-8 relative">
    <!-- Soft paper tint: a subtle radial wash so the warm paper hue
         (oklch 0.98 0.008 95) is visible even at small sizes. -->
    <div
      aria-hidden="true"
      class="absolute inset-0 pointer-events-none"
      style="
        background:
          radial-gradient(1200px 600px at 50% -10%, oklch(0.96 0.012 95) 0%, transparent 60%),
          radial-gradient(900px 500px at 50% 110%, oklch(0.95 0.015 95) 0%, transparent 55%);
      "
    />

    <div class="w-full max-w-sm relative">
      <!-- Brand mark: hanging-tag with notch -->
      <div class="flex flex-col items-center mb-8">
        <div class="relative inline-block">
          <!-- String -->
          <div
            aria-hidden="true"
            class="absolute left-1/2 -top-3 -translate-x-1/2 w-px h-3 bg-muted"
          />
          <!-- Tag: tilted rectangle with a notched bottom corner -->
          <div
            aria-hidden="true"
            class="relative inline-flex items-center justify-center w-16 h-16 bg-primary text-card font-bold text-2xl shadow-sm"
            style="
              clip-path: polygon(
                0% 0%,
                100% 0%,
                100% 70%,
                75% 70%,
                70% 100%,
                50% 80%,
                30% 100%,
                25% 70%,
                0% 70%
              );
              transform: rotate(-3deg);
            "
          >
            M
          </div>
        </div>
        <h1 class="text-xl font-semibold text-text mt-4">{{ $t('app.name') }}</h1>
      </div>

      <!-- Card -->
      <div class="border border-muted rounded-card bg-card p-6 shadow-sm relative overflow-hidden">
        <!-- Marker strip at the top of the card, echoes the dashboard clip bar -->
        <div aria-hidden="true" class="absolute top-0 left-0 right-0 h-1 bg-primary" />
        <slot />
      </div>
    </div>
  </div>
</template>

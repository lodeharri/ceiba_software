<script setup lang="ts">
/**
 * DashboardLayout — main app shell (design.md §8.6 wireframe top bar).
 * Top bar: MercadoExpress logo, sync indicator, admin dropdown, "Salir".
 * Slot for <RouterView />; responsive ≥ 360px.
 *
 * Visual refresh (pasada 2):
 *  - 4px indigo clip bar across the very top (signature "marker" strip).
 *  - Nav restyled as folder-tabs: thick bottom border + elevated bg
 *    for the active tab, using the .nav-tab component class.
 */
import { ref } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const menuOpen = ref(false);

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-surface">
    <!-- Top marker clip bar -->
    <div class="h-1 w-full bg-primary" aria-hidden="true" />

    <!-- Top bar -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-muted bg-card">
      <!-- Logo + brand -->
      <RouterLink
        to="/"
        class="flex items-center gap-2 text-text font-semibold text-base hover:opacity-80 transition-opacity"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          class="text-primary flex-shrink-0"
        >
          <path
            d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path d="M9 22V12h6v10" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        </svg>
        <span>{{ $t('app.name') }}</span>
      </RouterLink>

      <!-- Sync indicator -->
      <div class="flex items-center gap-2 text-xs text-text-muted">
        <span class="inline-block w-2 h-2 rounded-full bg-success" aria-hidden="true" />
        <span>{{ $t('app.syncStatus') }}</span>
      </div>

      <!-- User menu -->
      <div class="relative">
        <button
          class="flex items-center gap-2 px-3 py-1.5 border border-muted rounded-atom text-sm text-text hover:border-primary transition-all duration-hover"
          :aria-label="`${auth.user?.username ?? 'admin'}, ${$t('app.logout')}`"
          @click="menuOpen = !menuOpen"
        >
          <span class="font-medium">{{ auth.user?.username ?? 'admin' }}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>

        <!-- Dropdown -->
        <div
          v-if="menuOpen"
          class="absolute right-0 top-full mt-1 w-40 border border-muted rounded-modal bg-card shadow-lg z-20 py-1"
        >
          <button
            class="w-full text-left px-4 py-2 text-sm text-danger hover:bg-surface transition-colors"
            @click="logout"
          >
            {{ $t('app.logout') }}
          </button>
        </div>
      </div>
    </header>

    <!-- Nav (folder-tab style) -->
    <nav
      class="flex px-4 bg-card overflow-x-auto border-b border-muted"
      aria-label="Main navigation"
    >
      <RouterLink
        v-for="link in [
          { name: 'products-list', label: $t('nav.products') },
          { name: 'movements-list', label: $t('nav.movements') },
          { name: 'alerts-list', label: $t('nav.alerts') },
          { name: 'orders-list', label: $t('nav.orders') },
          { name: 'categories-list', label: $t('nav.categories') },
        ]"
        :key="link.name"
        :to="{ name: link.name }"
        class="nav-tab"
        active-class="nav-tab--active"
      >
        {{ link.label }}
      </RouterLink>
    </nav>

    <!-- Page content -->
    <main class="flex-1 px-4 py-0 max-w-7xl w-full mx-auto">
      <slot />
    </main>
  </div>
</template>

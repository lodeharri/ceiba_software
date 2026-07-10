import { createRouter, createWebHistory } from 'vue-router';
import type { Router } from 'vue-router';
import { routes } from './routes';
import { useAuthStore } from '@/stores/auth';
import { i18n } from '@/i18n';

export const router: Router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

// Guard: redirect unauthenticated users to /login
router.beforeEach((to, _from, next) => {
  const auth = useAuthStore();

  if (to.meta.requiresAuth && !auth.token) {
    // Persist intended destination for post-login redirect
    const redirect = to.fullPath !== '/' ? to.fullPath : undefined;
    return next({ name: 'login', query: redirect ? { redirect } : undefined });
  }

  next();
});

// Update <title> on navigation (design.md §7.4)
router.afterEach((to) => {
  if (to.meta.titleKey && typeof to.meta.titleKey === 'string') {
    const title = i18n.global.t(to.meta.titleKey as string);
    document.title = `${title} — MercadoExpress`;
  } else {
    document.title = 'MercadoExpress';
  }
});

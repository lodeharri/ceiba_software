import type { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

/**
 * Route records — MercadoExpress SPA.
 * Lazy-loaded for code-splitting (design.md §7.4).
 * layout: 'dashboard' → DashboardLayout; 'auth' → AuthLayout.
 *
 * Root `/` uses an auth-aware function redirect: authenticated users go
 * straight to /productos (dashboard landing), unauthenticated users land
 * on the clean /login URL without the `?redirect=/productos` query
 * string that previously polluted the address bar when the SPA was
 * entered via the bare host.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/auth/LoginPage.vue'),
    meta: { layout: 'auth', requiresAuth: false, titleKey: 'auth.title' },
  },
  {
    path: '/',
    redirect: () => (useAuthStore().token ? { name: 'products-list' } : { name: 'login' }),
  },
  {
    path: '/productos',
    name: 'products-list',
    component: () => import('../pages/products/ProductsListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'products.title' },
  },
  {
    path: '/productos/nuevo',
    name: 'product-create',
    component: () => import('../pages/products/ProductCreatePage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'products.createProduct' },
  },
  {
    path: '/productos/:id',
    name: 'product-detail',
    component: () => import('../pages/products/ProductDetailPage.vue'),
    props: true,
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'products.editProduct' },
  },
  {
    path: '/movimientos',
    name: 'movements-list',
    component: () => import('../pages/inventory/MovementsListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'inventory.title' },
  },
  {
    path: '/movimientos/nuevo',
    name: 'movement-create',
    component: () => import('../pages/inventory/RecordMovementPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'inventory.recordMovement' },
  },
  {
    path: '/alertas',
    name: 'alerts-list',
    component: () => import('../pages/alerts/AlertsListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'alerts.title' },
  },
  {
    path: '/alertas/:id',
    name: 'alert-detail',
    component: () => import('../pages/alerts/AlertDetailPage.vue'),
    props: true,
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'alerts.alertDetail' },
  },
  {
    path: '/ordenes',
    name: 'orders-list',
    component: () => import('../pages/orders/OrdersListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'orders.title' },
  },
  {
    path: '/ordenes/nueva',
    name: 'order-create',
    component: () => import('../pages/orders/OrderCreatePage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'orders.newOrder' },
  },
  {
    path: '/ordenes/:id',
    name: 'order-detail',
    component: () => import('../pages/orders/OrderDetailPage.vue'),
    props: true,
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'orders.orderDetail' },
  },
  {
    path: '/categorias',
    name: 'categories-list',
    component: () => import('../pages/categories/CategoriesListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, titleKey: 'categories.title' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../pages/NotFoundPage.vue'),
    meta: { layout: 'auth', requiresAuth: false, titleKey: 'error.notFound' },
  },
];

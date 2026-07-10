/**
 * Application bootstrap — MercadoExpress SPA.
 * Installs Pinia, router, and i18n (design.md §7).
 * Fontsource variable fonts are imported here (design.md §8.3).
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import { i18n } from './i18n';
import './styles/tailwind.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import App from './App.vue';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(router);
app.use(i18n);

// Restore auth session from localStorage before first navigation
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
auth.restore();

app.mount('#app');

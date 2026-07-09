/**
 * Application bootstrap stub. PR 0 only mounts an empty Vue app so
 * `pnpm --filter frontend build` succeeds; the real router, Pinia, and i18n
 * wire-up arrives in PR 3 per openspec/changes/add-inventory-mvp/tasks.md.
 */

import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { readApiBaseUrl } from './vite-env';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mercadoexpress/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: process.env.VITE_HOST ?? '0.0.0.0',
    port: Number(process.env.FRONTEND_PORT ?? 5173),
    strictPort: false,
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(readApiBaseUrl()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});

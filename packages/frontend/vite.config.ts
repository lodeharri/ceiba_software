import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { envValidation } from './vite-plugins/env-validation';

export default defineConfig({
  plugins: [vue(), envValidation()],
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
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});

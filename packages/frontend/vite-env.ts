/**
 * Typed `import.meta.env` accessors for the frontend (PR 3).
 *
 * Locks REQ-FVE-1 + REQ-FVE-2: the frontend reads configuration ONLY from
 * `VITE_*` environment variables. There is no filesystem import, no path
 * resolution, no fallback chain — Vite's standard env contract is the
 * single source of truth.
 *
 * The `envValidation()` Vite plugin in `./vite-plugins/env-validation.ts`
 * guarantees that `VITE_API_BASE_URL` is set (or the build/dev server
 * terminates with the lock-screen error message).
 */
/// <reference types="vite/client" />

/** Typed accessor for `VITE_API_BASE_URL`. */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL;
}

/** Typed accessor for `VITE_APP_NAME` (optional). */
export function getAppName(): string {
  return import.meta.env.VITE_APP_NAME ?? 'MercadoExpress';
}

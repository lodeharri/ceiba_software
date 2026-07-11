/**
 * Vite plugin: fail-loud when `VITE_API_BASE_URL` is missing or empty.
 *
 * Locks REQ-FHC-2 (frontend-http-client spec) and design.md §OQ-FHC-1:
 * the build/dev server MUST terminate with the exact error
 *   `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md`
 * before Vite's progress UI is rendered when the env var is unset or empty.
 *
 * Resolution order (matches what the runtime `http.ts` reads):
 *   1. `config.env.VITE_API_BASE_URL`  — Vite-merged env (process + .env files)
 *   2. `process.env.VITE_API_BASE_URL` — raw process env (CI / inline override)
 *
 * If neither yields a non-empty string, throw the required error during
 * `configResolved` (the hook that runs after Vite merges all config sources
 * but before the dev server binds or `build` emits any output).
 */
import type { Plugin } from 'vite';

const REQUIRED_ERROR = 'VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md';

function resolveBaseUrl(configEnv: Record<string, unknown> | undefined): string {
  const fromVite =
    typeof configEnv?.['VITE_API_BASE_URL'] === 'string'
      ? (configEnv['VITE_API_BASE_URL'] as string)
      : undefined;
  const fromProcess =
    typeof process.env.VITE_API_BASE_URL === 'string' ? process.env.VITE_API_BASE_URL : undefined;
  const candidate = (fromVite ?? fromProcess ?? '').trim();
  return candidate;
}

export function envValidation(): Plugin {
  return {
    name: 'mercadoexpress:env-validation',
    // `apply: 'build'` would scope to build only; we want the same fail-loud
    // behaviour for `vite dev` too, so leave `apply` undefined (runs always).
    configResolved(config) {
      const value = resolveBaseUrl(config.env);
      if (value.length === 0) {
        throw new Error(REQUIRED_ERROR);
      }
    },
  };
}

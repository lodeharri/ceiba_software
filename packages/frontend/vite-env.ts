/**
 * API base URL discovery helper for Vite (PR 4 — design.md §3.16).
 *
 * Precedence (per tasks.md §PR 4 TRIANGULATE — file wins over env var):
 *   1. The file at `process.env.API_URL_FILE` if set and readable.
 *   2. The file `./.api-url` if it exists at the cwd (non-container dev).
 *   3. The file `/shared/.api-url` if it exists (Docker bind mount).
 *   4. `process.env.VITE_API_BASE_URL` (set by `docker/frontend/entrypoint.sh`
 *      after the deployer writes the URL to the shared file).
 *   5. `undefined` — Vite then bakes the literal `undefined` into the bundle.
 */

import { existsSync, readFileSync } from 'node:fs';

export function readApiBaseUrl(): string | undefined {
  const candidatePaths = [process.env.API_URL_FILE, '.api-url', '/shared/.api-url'].filter(
    (p): p is string => Boolean(p),
  );

  for (const filePath of candidatePaths) {
    if (existsSync(filePath)) {
      const value = readFileSync(filePath, 'utf8').trim();
      if (value.length > 0) {
        return value;
      }
    }
  }

  if (process.env.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL;
  }
  return undefined;
}

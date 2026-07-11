/**
 * Public surface of `@mercadoexpress/infra`.
 *
 * Re-exports the single source of truth for Lambda routes (`LAMBDAS`,
 * defined in `stacks/ApiStack.ts`) so downstream consumers — most importantly
 * `scripts/dev-server.ts` — can import it via the bare workspace specifier
 * `@mercadoexpress/infra` rather than reaching into a deep relative path.
 *
 * Keeping this surface intentionally narrow: anything else the dev server
 * or a test might want from infra should be added here explicitly, with a
 * brief comment justifying the leak.
 *
 * PR 1, design.md §11 (cross-spec invariant): `LAMBDAS` lives in
 * `packages/infra/src/stacks/ApiStack.ts` and is the single route table.
 *
 * Entry-path normalization (PR 1, Task 1.10 GREEN side-effect):
 *   `LAMBDAS[].entry` is computed by `backendHandlerPath()` in
 *   `stacks/ApiStack.ts`. The original resolver assumes `infra/dist/src/...`
 *   (a 4-segment `..` chain). When `LAMBDAS` is consumed via this module
 *   (which is itself sourced from `infra/src/index.ts` via `tsx`), the
 *   computed path is one directory short and points at `<root>/backend/...`
 *   instead of `<root>/packages/backend/...`. We rewrite here so the dev
 *   server's `await import(spec.entry)` resolves correctly under both
 *   source and dist scenarios.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { LAMBDAS as RAW_LAMBDAS } from './stacks/ApiStack.js';
import type { LambdaSpec as LambdaSpecRaw } from './stacks/ApiStack.js';

function workspaceRootFromInfra(): string {
  // This file lives at `packages/infra/src/index.ts` (or under `dist/`).
  // Resolve the workspace root by walking up until we find `packages/`.
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  for (let i = 0; i < 8; i += 1) {
    if (dir.endsWith('/packages/infra') || dir.endsWith('\\packages\\infra')) {
      return resolve(dir, '..', '..');
    }
    dir = dirname(dir);
  }
  // Fallback: assume the cwd is the workspace root.
  return process.cwd();
}

const WORKSPACE_ROOT = workspaceRootFromInfra();

function normalizeEntry(entry: string): string {
  // The dist case (production / built path): `entry` starts with the
  // workspace root AND the next segment is `packages/`. Return as-is.
  if (entry.startsWith(`${WORKSPACE_ROOT}/packages/`)) return entry;
  // The source case: `entry` starts with the workspace root but the
  // `<bc>/src/...` segment is missing the `packages/` sibling — a path
  // bug carried from the original 4-level `..` walk in
  // `backendHandlerPath()` (which assumed `dist/`). Re-anchor it.
  if (entry.startsWith(WORKSPACE_ROOT)) {
    const tail = entry.slice(WORKSPACE_ROOT.length).replace(/^\/+/, '');
    // tail is like `backend/src/auth/...`; re-prefix with `packages/`.
    const fixed = `packages/${tail}`;
    return resolve(WORKSPACE_ROOT, fixed);
  }
  // Fallback: take the input at face value (e.g. a relative path or a
  // path passed in via test mocks).
  return entry;
}

/**
 * The re-exported `LAMBDAS` route table with each entry's `entry` path
 * normalized so it resolves under both `dist/` and source `.ts` consumers.
 * The shape is otherwise identical to the underlying `LambdaSpec`.
 */
export const LAMBDAS: ReadonlyArray<LambdaSpecRaw> = (() => {
  return RAW_LAMBDAS.map((spec) => ({
    ...spec,
    entry: normalizeEntry(spec.entry),
  }));
})();

export type LambdaSpec = LambdaSpecRaw;

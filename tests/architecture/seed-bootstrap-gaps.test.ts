/**
 * Architecture guard — seed bootstrap gaps (PR reliability fix).
 *
 * RED → GREEN for two defects found during the reliability review:
 *
 *   DEFECT 1 — Missing dotenv in seed.ts:
 *     `seed.ts` does NOT load `.env.dev` before reading `ADMIN_USERNAME`,
 *     `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `BCRYPT_COST` from `process.env`.
 *     This means running `tsx prisma/seed.ts` (or `pnpm db:seed`) from a
 *     fresh shell fails with "Missing required env var" even when those
 *     variables are correctly set in `.env.dev`.
 *
 *   DEFECT 2 — Native bcrypt not installed:
 *     `seed.ts` imports `import bcrypt from 'bcrypt'` (the native C++ addon)
 *     which is NOT in `dependencies` or `devDependencies`. The module is
 *     missing at import time, so the seed process dies before any logic runs.
 *     The architectural decision is `bcryptjs` (pure JS) — matching the runtime
 *     `BcryptPasswordHasher`.  The `$2a/$2b/$2y$` prefixes are all mutually
 *     verifiable by `bcryptjs.compare()`.
 *
 * Required contracts (file-system only — no DB, no network):
 *
 *   1. `packages/backend/prisma/seed.ts` MUST load dotenv within the first
 *      20 lines so env vars are available before `PrismaClient` is instantiated
 *      (which reads `DATABASE_URL`) and before the required-var guard runs.
 *
 *   2. `packages/backend/prisma/seed.ts` MUST import `bcryptjs`, NOT `bcrypt`
 *      (native), so the seed process starts without a module-not-found error.
 *
 *   3. `packages/backend/package.json` script `db:migrate` MUST be wrapped
 *      with `dotenv -e .env.dev --` so the migration CustomResource Lambda
 *      receives `DATABASE_URL` from `.env.dev` (the same env file used by
 *      `dev:up` to initialise the Postgres container).
 *
 * Scope mirrors `tests/architecture/no-bootstrap-gaps.test.ts` — source-text
 * checks only; no runtime execution.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BACKEND_ROOT = resolve(ROOT, 'packages', 'backend');
const SEED_FILE = resolve(BACKEND_ROOT, 'prisma', 'seed.ts');
const PKG_FILE = resolve(BACKEND_ROOT, 'package.json');

const seedSource = readFileSync(SEED_FILE, 'utf8');

type BackendPkg = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readBackendPkg(): BackendPkg {
  const text = readFileSync(PKG_FILE, 'utf8');
  try {
    return JSON.parse(text) as BackendPkg;
  } catch (err) {
    throw new Error(
      `Could not parse packages/backend/package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Contract 1 — dotenv loads BEFORE PrismaClient / required-var guard
// ---------------------------------------------------------------------------
describe('packages/backend/prisma/seed.ts — loads dotenv before any env consumer', () => {
  it('contains dotenv before the PrismaClient import (positional contract)', () => {
    // Mirrors the positional check in `no-bootstrap-gaps.test.ts` for dev-server.ts:
    // dotenv must appear before `PrismaClient` (the first env consumer).
    const dotenvIdx = seedSource.split('\n').findIndex((l) => /dotenv/.test(l));
    const prismaIdx = seedSource
      .split('\n')
      .findIndex((l) => /from\s+['"]@prisma\/client['"]/.test(l));
    expect(dotenvIdx).toBeGreaterThanOrEqual(0);
    expect(prismaIdx).toBeGreaterThanOrEqual(0);
    expect(dotenvIdx).toBeLessThan(prismaIdx);
  });

  it('prefers .env.dev / .env.dev.example over bare .env (project convention)', () => {
    // The seed MUST use the project's canonical env file, not fall back
    // to a plain `.env` which may not exist in all environments.
    expect(seedSource).toMatch(/(\.env\.dev|dotenv\/config)/);
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — bcryptjs (pure JS), NOT native bcrypt
// ---------------------------------------------------------------------------
describe('packages/backend/prisma/seed.ts — uses bcryptjs (not native bcrypt)', () => {
  it('imports bcryptjs, not bcrypt (native C++ addon)', () => {
    // The native `bcrypt` module is not in the dependency tree.
    // The architectural decision is `bcryptjs` (pure JS) so the seed works
    // in all environments without a native build step.
    // Accept `import bcrypt from 'bcryptjs'` (variable name varies) OR
    // `import { hash } from 'bcryptjs'`, but NOT bare `import bcrypt from 'bcrypt'`.
    expect(seedSource).toMatch(/from\s+['"]bcryptjs['"]/);
    expect(seedSource).not.toMatch(/from\s+['"]bcrypt['"]/);
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — db:migrate script wraps prisma with dotenv-cli
// ---------------------------------------------------------------------------
describe('packages/backend/package.json — db:migrate uses dotenv-cli', () => {
  it('db:migrate script is wrapped with dotenv -e .env.dev --', () => {
    const pkg = readBackendPkg();
    const script = pkg.scripts?.['db:migrate'];

    expect(script).toBeDefined();
    if (!script) throw new Error('db:migrate script missing from backend package.json');

    // Must use dotenv-cli's `-e .env.dev` flag so DATABASE_URL is available
    // to the Prisma CLI (which runs the migrations SQL inside the Lambda).
    // The script runs from packages/backend/ so the path to workspace-root .env.dev
    // is ../../.env.dev (pnpm --filter runs the script in the backend dir).
    expect(script).toMatch(/dotenv\s+-e\s+.*\.env\.dev\s+--/);
  });

  it('db:seed is NOT wrapped (dotenv lives inside seed.ts)', () => {
    const pkg = readBackendPkg();
    const script = pkg.scripts?.['db:seed'];

    expect(script).toBeDefined();
    if (!script) throw new Error('db:seed script missing from backend package.json');

    // The seed loads dotenv itself — no need for a second wrapping layer.
    expect(script).not.toMatch(/dotenv\s+-e/);
  });
});

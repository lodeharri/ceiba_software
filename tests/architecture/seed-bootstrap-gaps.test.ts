/**
 * Architecture guard — seed bootstrap gaps (PR reliability fix).
 *
 * RED → GREEN for two defects found during the reliability review:
 *
 *   DEFECT 1 — Missing dotenv in seed.ts:
 *     `seed.ts` does NOT load `.env.dev` before reading `ADMIN_USERNAME`,
 *     `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `BCRYPT_COST` from `process.env`.
 *     This means running `tsx src/db/seed.ts` (or `pnpm db:seed`) from a
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
 *   1. `packages/backend/src/db/seed.ts` MUST load dotenv within the first
 *      20 lines so env vars are available before `db.connect()` is called
 *      and before the required-var guard runs.
 *
 *   2. `packages/backend/src/db/seed.ts` MUST import `bcryptjs`, NOT `bcrypt`
 *      (native), so the seed process starts without a module-not-found error.
 *
 *   3. Root `package.json` script `db:migrate` MUST use `tsx scripts/db.ts migrate`
 *      so the wrapper loads `.env.dev` before the migration command
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
const SEED_FILE = resolve(BACKEND_ROOT, 'src', 'db', 'seed.ts');
const ROOT_PKG_FILE = resolve(ROOT, 'package.json');

const seedSource = readFileSync(SEED_FILE, 'utf8');

type Pkg = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readRootPkg(): Pkg {
  const text = readFileSync(ROOT_PKG_FILE, 'utf8');
  try {
    return JSON.parse(text) as Pkg;
  } catch (err) {
    throw new Error(
      `Could not parse root package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Contract 1 — dotenv loads BEFORE bcryptjs / required-var guard
// ---------------------------------------------------------------------------
describe('packages/backend/src/db/seed.ts — loads dotenv before any env consumer', () => {
  it('contains dotenv before bcryptjs (positional contract)', () => {
    // Mirrors the positional check in `no-bootstrap-gaps.test.ts` for dev-server.ts:
    // dotenv must appear before bcryptjs (the first env-dependent import).
    const dotenvIdx = seedSource.split('\n').findIndex((l) => /dotenv/.test(l));
    const bcryptIdx = seedSource.split('\n').findIndex((l) => /from\s+['"]bcryptjs['"]/.test(l));
    expect(dotenvIdx).toBeGreaterThanOrEqual(0);
    expect(bcryptIdx).toBeGreaterThanOrEqual(0);
    expect(dotenvIdx).toBeLessThan(bcryptIdx);
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
describe('packages/backend/src/db/seed.ts — uses bcryptjs (not native bcrypt)', () => {
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
// Contract 3 — root db:migrate wraps drizzle-kit via scripts/db.ts
// ---------------------------------------------------------------------------
describe('root package.json — db:migrate loads .env.dev before running', () => {
  it('db:migrate script loads .env.dev via scripts/db.ts', () => {
    const pkg = readRootPkg();
    const script = pkg.scripts?.['db:migrate'];

    expect(script).toBeDefined();
    if (!script) throw new Error('db:migrate script missing from root package.json');

    // scripts/db.ts loads dotenv + .env.dev before running the actual migrate command,
    // so DATABASE_URL is available to drizzle-kit.
    expect(script).toMatch(/tsx\s+scripts\/db\.ts\s+migrate/);
  });

  it('db:seed script loads .env.dev via scripts/db.ts', () => {
    const pkg = readRootPkg();
    const script = pkg.scripts?.['db:seed'];

    expect(script).toBeDefined();
    if (!script) throw new Error('db:seed script missing from root package.json');

    // The seed wrapper loads dotenv itself before invoking the seed logic.
    expect(script).toMatch(/tsx\s+scripts\/db\.ts\s+seed/);
  });
});

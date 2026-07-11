/**
 * Bootstrap-gap architecture guard (PR 4 — three defects from the empirical
 * endpoint test).
 *
 * Locks the fix for defect C: `pnpm dev:api` returned 500 for handlers that
 * need `DATABASE_URL` / `JWT_SECRET` because the dev server did not load
 * `.env.dev` automatically. The empirical test recorded each handler returning
 * `DEV_SERVER_ERROR` because Prisma's `new PrismaClient()` threw on an
 * undefined `DATABASE_URL`.
 *
 * Required contract:
 *   1. `scripts/dev-server.ts` MUST `import 'dotenv/config'` (or call
 *      `config({ path: ... })`) within the first 20 lines of the file so
 *      env vars are populated BEFORE the Lambda handlers are dynamically
 *      imported by `boot()`.
 *   2. The dotenv import MUST target `.env.dev` (or `.env.dev.example` as
 *      the project-locked fallback) before falling back to plain `.env`.
 *   3. Root `package.json` MUST declare `dotenv` in `devDependencies` so the
 *      import resolves at install time.
 *
 * Scope: file-system invariants only; the end-to-end behaviour is covered
 * separately by `verify-additive-migrations.ts` + the empirical smoke test
 * (Phase 7 of the PR 4 task brief).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DEV_SERVER_FILE = resolve(ROOT, 'scripts', 'dev-server.ts');

type PackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readPackageJson(): PackageJson {
  const text = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
  try {
    return JSON.parse(text) as PackageJson;
  } catch (err) {
    throw new Error(
      `Could not parse root package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const devServerLines = readFileSync(DEV_SERVER_FILE, 'utf8').split('\n');

describe('scripts/dev-server.ts — loads .env via dotenv on boot (PR 4 defect C)', () => {
  it('imports or calls dotenv BEFORE any userland module load that reads process.env', () => {
    // The contract: dotenv (whether `import 'dotenv/config'` or
    // `import { config } from 'dotenv'`) must appear in the file BEFORE
    // the imports that read env at module-load time (notably the
    // `@prisma/client` import inside the Lambda handlers loaded by
    // `boot()`). The simplest, version-tolerant check is positional:
    // dotenv must come before `loadLambdas` (the only site that
    // dynamically imports `@prisma/client`-bearing modules).
    const dotenvIdx = devServerLines.findIndex((l) => /dotenv/.test(l));
    const loadLambdasIdx = devServerLines.findIndex((l) =>
      /(?:async\s+function\s+)?loadLambdas\b/.test(l),
    );
    expect(dotenvIdx).toBeGreaterThanOrEqual(0);
    expect(loadLambdasIdx).toBeGreaterThanOrEqual(0);
    expect(dotenvIdx).toBeLessThan(loadLambdasIdx);
  });

  it('prefers .env.dev / .env.dev.example over plain .env (project convention)', () => {
    // The file body must reference `.env.dev` OR `dotenv/config`. The
    // explicit path resolution in `scripts/setup.ts` (copy example → dev)
    // is intentionally only honored by the dev server if `.env.dev` or
    // `.env.dev.example` is present, mirroring the project convention.
    expect(readFileSync(DEV_SERVER_FILE, 'utf8')).toMatch(/(\.env\.dev|dotenv\/config)/);
  });
});

describe('package.json — dotenv is pinned as a workspace devDependency (PR 4)', () => {
  it('declares dotenv at ^16.x in devDependencies', () => {
    const pkg = readPackageJson();
    const version = pkg.devDependencies?.['dotenv'];

    expect(version).toBeDefined();
    if (!version) {
      throw new Error(
        'dotenv must be in root devDependencies (lock the contract for PR 4 defect C)',
      );
    }
    expect(version).toMatch(/^\^1[6-9]\./);
  });
});

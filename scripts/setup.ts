#!/usr/bin/env tsx
/**
 * `pnpm setup` — one-shot dev environment bootstrap (PR 4).
 *
 * Closes the three defects that block a fresh-clone dev:
 *   A. 0_init/migration.sql is hand-edited to emit `CREATE TYPE "Role"`
 *   B. scripts/events/apigw-v2-builder.ts sets `routeKey` to include the
 *      `/api/v1` prefix so the per-BC dispatchers can match.
 *   C. scripts/dev-server.ts auto-loads `.env.dev` via dotenv before any
 *      handler is imported (so `DATABASE_URL` / `JWT_SECRET` are present).
 *
 * After this PR the developer flow reduces to:
 *
 *   pnpm install
 *   pnpm setup     # <-- THIS SCRIPT
 *   pnpm dev       # concurrent dev:api + dev:web
 *
 * Phases:
 *   1. Pre-flight          — assert docker + pnpm exist, env file present.
 *   2. Copy env example    — `.env.dev.example` → `.env.dev` if missing
 *                            (NEVER edit `.env.dev` itself).
 *   3. Install             — `pnpm install` (skipped with `--skip-install`).
 *   4. Compose up          — `pnpm dev:up` (idempotent).
 *   5. Healthcheck poll    — wait for postgres + localstack to be 'healthy'.
 *   6. Migrate             — `pnpm --filter backend exec prisma migrate deploy`.
 *   7. Seed                — `pnpm db:seed` (one retry on transient failure).
 *   8. Summary             — point the developer at `pnpm dev`.
 *
 * Idempotency: every phase is a no-op on re-run. `docker compose up -d` is a
 * no-op when the services are already healthy; `prisma migrate deploy` is
 * idempotent against an already-migrated schema; the seed uses upserts.
 *
 * Exit codes:
 *   0 — every phase succeeded.
 *   1 — a phase failed; the failing command's stderr is replayed for the
 *       caller. Re-running `pnpm setup` will resume from the same point.
 */

import { existsSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

const ROOT = new URL('..', import.meta.url).pathname;
process.chdir(ROOT);

// PR 4 follow-up: load `.env.dev` (or `.env.dev.example` as fallback) into
// `process.env` BEFORE any `execSync` runs. The previous version of this
// script assumed `pnpm dev:up` / `pnpm db:seed` would load env themselves;
// they do not — `pnpm dev:up` shells out to `docker compose` without
// `--env-file` and `pnpm db:seed` requires `ADMIN_USERNAME` in `process.env`.
// Without this load, every phase after preflight fails.
if (existsSync('.env.dev')) {
  loadEnv({ path: '.env.dev' });
} else if (existsSync('.env.dev.example')) {
  loadEnv({ path: '.env.dev.example' });
}

interface RunResult {
  ok: boolean;
  message: string;
}

function step(label: string): void {
  // Single-line status so the user can see what is happening.
  process.stdout.write(`\n[pnpm setup] ▶ ${label}\n`);
}

function ok(msg: string): void {
  process.stdout.write(`[pnpm setup] ✓ ${msg}\n`);
}

function fail(msg: string, detail?: string): never {
  process.stderr.write(`[pnpm setup] ✗ ${msg}\n`);
  if (detail !== undefined) {
    process.stderr.write(`${detail}\n`);
  }
  process.exit(1);
}

function run(cmd: string, label: string): RunResult {
  step(label);
  try {
    execSync(cmd, { stdio: 'inherit', env: process.env });
    return { ok: true, message: label };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `${label}: ${message}` };
  }
}

function preflight(): void {
  step('Phase 1 — pre-flight checks');
  try {
    execSync('command -v docker', { stdio: 'pipe' });
  } catch {
    fail(
      'docker not found on PATH',
      'Install Docker Desktop or docker-ce + docker-compose-plugin.',
    );
  }
  try {
    execSync('command -v pnpm', { stdio: 'pipe' });
  } catch {
    fail('pnpm not found on PATH', 'Install pnpm 9+: `npm install -g pnpm`');
  }
  if (!existsSync('.env.dev') && !existsSync('.env.dev.example')) {
    fail(
      'Neither .env.dev nor .env.dev.example is present.',
      'Restore .env.dev.example from the repo or run `cp .env.dev.example .env.dev`.',
    );
  }
  ok('docker + pnpm + env file present');
}

function ensureEnvFile(): void {
  step('Phase 2 — ensure .env.dev exists');
  if (existsSync('.env.dev')) {
    ok('.env.dev already present (skipped copy)');
    return;
  }
  if (!existsSync('.env.dev.example')) {
    fail('.env.dev.example is missing — cannot bootstrap .env.dev.');
  }
  copyFileSync('.env.dev.example', '.env.dev');
  ok('.env.dev.example → .env.dev copied');
  process.stdout.write(
    '[pnpm setup] !!  Edit .env.dev now — set JWT_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.\n',
  );
}

function install(allowSkip: boolean): void {
  step('Phase 3 — pnpm install');
  if (allowSkip && process.argv.includes('--skip-install')) {
    ok('skip-install flag passed — skipped');
    return;
  }
  const r = run('pnpm install --prefer-offline', 'pnpm install');
  if (!r.ok) fail('pnpm install failed', r.message);
  ok('dependencies installed');
}

function composeUp(): void {
  step('Phase 4 — docker compose up');
  // The root `pnpm dev:up` script invokes `docker compose -f docker-compose.dev.yml up -d`
  // WITHOUT `--env-file`, which causes docker compose to fail to interpolate
  // `${LOCALSTACK_HEALTHCHECK_RETRIES}` (and friends) with empty strings.
  // We invoke docker compose directly with the env file loaded by this script.
  const envFile = existsSync('.env.dev') ? '.env.dev' : '.env.dev.example';
  const cmd = `docker compose --env-file ${envFile} -f docker-compose.dev.yml up -d`;
  const r = run(cmd, cmd);
  if (!r.ok) fail('docker compose up failed', r.message);
  ok('postgres + localstack containers requested');
}

function waitForHealthy(maxAttempts = 60, intervalMs = 2_000): void {
  step('Phase 5 — wait for compose healthchecks (postgres, localstack)');
  // ${POSTGRES_CONTAINER_NAME} / ${LOCALSTACK_CONTAINER_NAME} come from
  // .env.dev. `compose -f docker-compose.dev.yml config` does NOT need the
  // env file but the container-name interpolation in `docker inspect` does.
  const postgresName = process.env['POSTGRES_CONTAINER_NAME'] ?? 'ceiba-postgres';
  const localstackName = process.env['LOCALSTACK_CONTAINER_NAME'] ?? 'ceiba-localstack';

  function healthy(container: string): boolean {
    try {
      const status = execSync(`docker inspect --format '{{.State.Health.Status}}' '${container}'`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
      return status === 'healthy';
    } catch {
      return false;
    }
  }

  const deadline = Date.now() + maxAttempts * intervalMs;
  while (Date.now() < deadline) {
    if (healthy(postgresName) && healthy(localstackName)) {
      ok(`postgres + localstack reported healthy`);
      return;
    }
    process.stdout.write('.');
    try {
      execSync(`sleep ${intervalMs / 1000}`);
    } catch {
      /* sleep may fail on Windows; ignore */
    }
  }
  fail(
    `compose healthchecks did not become healthy within ${(maxAttempts * intervalMs) / 1000}s`,
    'Inspect `docker compose -f docker-compose.dev.yml ps` for the failing service.',
  );
}

function migrate(): void {
  step('Phase 6 — prisma migrate deploy');
  const cmd = 'pnpm --filter backend exec prisma migrate deploy';
  const r = run(cmd, cmd);
  if (!r.ok) fail('prisma migrate deploy failed', r.message);
  ok('migrations applied');
}

function seed(): void {
  step('Phase 7 — db:seed');
  // The empirical test showed the seed occasionally races with postgres
  // becoming ready; one retry covers it.
  const cmd = 'pnpm db:seed';
  const r = run(cmd, cmd);
  if (r.ok) {
    ok('admin user + reference data seeded');
    return;
  }
  process.stderr.write('[pnpm setup] seed failed — retrying once after 3 s...\n');
  try {
    execSync('sleep 3');
  } catch {
    /* sleep may fail on Windows; ignore */
  }
  const r2 = run(cmd, cmd);
  if (!r2.ok) fail('pnpm db:seed failed after retry', r2.message);
  ok('admin user + reference data seeded (retry)');
}

function summary(): void {
  step('Phase 8 — done');
  process.stdout.write('\n');
  process.stdout.write('┌────────────────────────────────────────────────────┐\n');
  process.stdout.write('│  Dev environment is ready.                          │\n');
  process.stdout.write('│                                                    │\n');
  process.stdout.write('│   next:  pnpm dev      (concurrent api + web)       │\n');
  process.stdout.write('│                                                    │\n');
  process.stdout.write('│   • API  http://localhost:3001                      │\n');
  process.stdout.write('│   • Web  http://localhost:5173                      │\n');
  process.stdout.write('│   • DBC  postgres   (port 5432)                     │\n');
  process.stdout.write('│   • LSK  localstack (port 4566)                     │\n');
  process.stdout.write('│                                                    │\n');
  process.stdout.write('│   Health:   curl http://localhost:3001/api/v1/health │\n');
  process.stdout.write('└────────────────────────────────────────────────────┘\n');
}

function main(): void {
  preflight();
  ensureEnvFile();
  install(true);
  composeUp();
  waitForHealthy();
  migrate();
  seed();
  summary();
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pnpm setup] aborted: ${msg}\n`);
    process.exit(1);
  }
}

export { preflight, ensureEnvFile, install, composeUp, waitForHealthy, migrate, seed, summary };

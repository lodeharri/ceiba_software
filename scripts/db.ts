#!/usr/bin/env tsx
/**
 * Local-DB helper: load `.env.dev` if needed and run the requested DB subcommand.
 *
 * Replaces `dotenv-cli` (which pnpm does not link into `.bin/` reliably in
 * this monorepo). Used as the implementation of:
 *   - `pnpm db:migrate`  →  drizzle-kit migrate
 *   - `pnpm db:seed`     →  tsx src/db/seed.ts
 *
 * Usage:
 *   tsx scripts/db.ts migrate
 *   tsx scripts/db.ts seed
 *
 * Behaviour:
 *   - If `DATABASE_URL` is already set in `process.env` (CI workflow or any
 *     caller that injects secrets), skip the file load entirely. This keeps
 *     the GitHub Actions `migrate.yml` workflow working, which sets the URL
 *     from Secrets Manager.
 *   - Otherwise, load `.env.dev` (or `.env.dev.example` as fallback) so local
 *     developers get the same DATABASE_URL the dev containers use.
 *   - Fail fast if neither env-var nor env-file provides DATABASE_URL.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

const ROOT = new URL('..', import.meta.url).pathname;
process.chdir(ROOT);

const hasDatabaseUrl =
  typeof process.env['DATABASE_URL'] === 'string' && process.env['DATABASE_URL']!.length > 0;

if (!hasDatabaseUrl) {
  const envFile = existsSync('.env.dev')
    ? '.env.dev'
    : existsSync('.env.dev.example')
      ? '.env.dev.example'
      : null;

  if (envFile) {
    loadEnv({ path: envFile });
    console.log(`[scripts/db.ts] loaded env from ${envFile}`);
  } else {
    console.error('[scripts/db.ts] DATABASE_URL not set and no .env.dev found — aborting');
    process.exit(1);
  }
} else {
  console.log('[scripts/db.ts] DATABASE_URL already set in env; skipping .env.dev load');
}

const command = process.argv[2];
if (command !== 'migrate' && command !== 'seed') {
  console.error(`[scripts/db.ts] unknown command: ${command ?? '(missing)'}`);
  console.error('  usage: tsx scripts/db.ts <migrate|seed>');
  process.exit(1);
}

const cmd =
  command === 'migrate'
    ? 'pnpm --filter @mercadoexpress/backend exec drizzle-kit migrate'
    : 'pnpm --filter @mercadoexpress/backend exec tsx src/db/seed.ts';

console.log(`[scripts/db.ts] running: ${cmd}`);
const result = spawnSync(cmd, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);

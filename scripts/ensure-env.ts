#!/usr/bin/env tsx
/**
 * Bootstrap .env.dev from .env.dev.example if missing.
 *
 * Idempotent. Safe to run on every `pnpm dev`.
 * - If .env.dev exists: log "env already present" and exit 0.
 * - If .env.dev.example exists: copy it to .env.dev, log "bootstrapped", exit 0.
 * - If neither exists: log error and exit 1 (don't fabricate values).
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TARGET = resolve(ROOT, '.env.dev');
const TEMPLATE = resolve(ROOT, '.env.dev.example');

if (existsSync(TARGET)) {
  console.log('[env:bootstrap] .env.dev already present — no-op');
  process.exit(0);
}

if (!existsSync(TEMPLATE)) {
  console.error('[env:bootstrap] FATAL: .env.dev.example not found at', TEMPLATE);
  console.error('Cannot bootstrap .env.dev. Create .env.dev manually before running pnpm dev.');
  process.exit(1);
}

copyFileSync(TEMPLATE, TARGET);
console.log('[env:bootstrap] .env.dev created from .env.dev.example');
console.log(
  '[env:bootstrap] NOTE: edit .env.dev to set JWT_SECRET, ADMIN_PASSWORD, AWS_* keys before use.',
);

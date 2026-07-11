/**
 * Role enum contract for `0_init/migration.sql` (PR 4 — bootstrap fix).
 *
 * RED→GREEN for the seed-blocking defect:
 *   `pnpm db:seed` failed with `type "public.Role" does not exist` because
 *   the seed calls `prisma.user.upsert({ ... role: 'admin' })` and the
 *   Postgres `users.role` column was typed `TEXT` (no enum defined).
 *
 * The schema (`schema.prisma`) declares `enum Role { admin }`, but the
 * hand-written `0_init/migration.sql` never emitted `CREATE TYPE "Role"`.
 * This test locks the migration to:
 *   1. emit `CREATE TYPE "Role" AS ENUM ('admin')` before the `users` table;
 *   2. type the `users.role` column with that enum (not plain TEXT);
 *   3. default the column to `'admin'::"Role"` (not `'admin'::text`).
 *
 * Why a string-regex test (not a DB-integration test):
 *   The empirical re-run that discovered this defect proved the failure is
 *   deterministic from the SQL text — re-running a real Postgres container
 *   per CI run costs minutes and gives no extra signal. The PR 3 architecture
 *   tests use the same source-text approach (see `tests/architecture/`).
 *
 * Scope: `packages/backend/prisma/migrations/0_init/migration.sql` only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(HERE, '..', '..');
const MIGRATION_FILE = resolve(BACKEND_ROOT, 'prisma', 'migrations', '0_init', 'migration.sql');
const SCHEMA_FILE = resolve(BACKEND_ROOT, 'prisma', 'schema.prisma');

const migration = readFileSync(MIGRATION_FILE, 'utf8');
const schema = readFileSync(SCHEMA_FILE, 'utf8');

/** Tokenize the SQL: blank lines, `--` comments, and the SQL itself. */
const activeStatements = migration
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'));

describe('0_init/migration.sql — Role enum present (PR 4 bootstrap fix)', () => {
  it('declares the schema.prisma Role enum (`enum Role { admin }`)', () => {
    // Sanity check on the reference schema. Locks the contract: if schema
    // ever drops Role, this test surfaces the mismatch via the migration.
    expect(schema).toMatch(/enum\s+Role\s*\{[^}]*\badmin\b[^}]*\}/);
  });

  it('emits CREATE TYPE "Role" AS ENUM (...) before CREATE TABLE "users"', () => {
    const createTypeLine = activeStatements.find((l) =>
      /^CREATE\s+TYPE\s+"Role"\s+AS\s+ENUM/i.test(l),
    );
    const createUsersLine = activeStatements.find((l) => /^CREATE\s+TABLE\s+"users"/i.test(l));
    if (!createTypeLine)
      throw new Error('CREATE TYPE "Role" AS ENUM line must exist in the migration');
    if (!createUsersLine) throw new Error('CREATE TABLE "users" line must exist in the migration');

    const typeIdx = activeStatements.indexOf(createTypeLine);
    const usersIdx = activeStatements.indexOf(createUsersLine);
    expect(typeIdx).toBeLessThan(usersIdx);

    // Must include admin — matches the schema's single-value enum.
    expect(createTypeLine).toMatch(/AS\s+ENUM\s*\(\s*'admin'\s*\)/i);
  });

  it('users.role column uses the enum (NOT plain TEXT) and default uses the enum cast', () => {
    // Extract the `users` CREATE TABLE block so we don't accidentally match
    // the CREATE TYPE "Role" line (which also contains the literal "Role").
    const usersBlockMatch = migration.match(/CREATE\s+TABLE\s+"users"\s*\(([\s\S]*?)\);\s*$/im);
    if (!usersBlockMatch) {
      throw new Error('CREATE TABLE "users" block must be present');
    }
    const usersBlock = usersBlockMatch[1];

    // Inside the users block, find the `role` column definition line.
    const roleLine = usersBlock
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^"role"\s+/.test(l));
    if (!roleLine) {
      throw new Error('"role" column definition must be present inside users block');
    }

    // Negative: not plain TEXT
    expect(roleLine).not.toMatch(/^"role"\s+TEXT\s/i);
    // Positive: typed as the enum ("Role") with NOT NULL + DEFAULT
    expect(roleLine).toMatch(/^"role"\s+"Role"\s+NOT\s+NULL\s+DEFAULT\s+'admin'::"Role"\s*,?\s*$/i);
  });
});

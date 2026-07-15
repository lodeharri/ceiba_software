/**
 * Role enum contract for `drizzle/0000_initial.sql` (PR 1.2 — Drizzle migration).
 *
 * Verifies that the migration SQL contains:
 *   1. CREATE TYPE "public"."role" AS ENUM('admin') before CREATE TABLE "users"
 *   2. users.role column uses the enum (not plain TEXT)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(HERE, '..', '..');
const MIGRATION_FILE = resolve(BACKEND_ROOT, 'drizzle', '0000_initial.sql');

const migration = readFileSync(MIGRATION_FILE, 'utf8');

/** Tokenize the SQL: blank lines and comments removed. */
const activeStatements = migration
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'));

describe('drizzle/0000_initial.sql — role enum present (PR 1.2)', () => {
  it('emits CREATE TYPE "public"."role" AS ENUM(...) before CREATE TABLE "users"', () => {
    const createTypeLine = activeStatements.find((l) =>
      /^CREATE\s+TYPE\s+"public"\."role"\s+AS\s+ENUM/i.test(l),
    );
    const createUsersLine = activeStatements.find((l) => /^CREATE\s+TABLE\s+"users"/i.test(l));
    if (!createTypeLine)
      throw new Error('CREATE TYPE "public"."role" AS ENUM line must exist in the migration');
    if (!createUsersLine) throw new Error('CREATE TABLE "users" line must exist in the migration');

    const typeIdx = activeStatements.indexOf(createTypeLine);
    const usersIdx = activeStatements.indexOf(createUsersLine);
    expect(typeIdx).toBeLessThan(usersIdx);

    // Must include admin
    expect(createTypeLine).toMatch(/AS\s+ENUM\s*\(\s*'admin'\s*\)/i);
  });

  it('users.role column uses the enum (NOT plain TEXT)', () => {
    // Extract the `users` CREATE TABLE block
    const usersBlockMatch = migration.match(/CREATE\s+TABLE\s+"users"\s*\(([\s\S]*?)\);\s*$/im);
    if (!usersBlockMatch) {
      throw new Error('CREATE TABLE "users" block must be present');
    }
    const usersBlock = usersBlockMatch[1]!;

    // Find the `role` column definition line
    const roleLine = usersBlock
      .split('\n')
      .map((l: string) => l.trim())
      .find((l: string) => /^"role"\s+/.test(l));
    if (!roleLine) {
      throw new Error('"role" column definition must be present inside users block');
    }

    // Must NOT be plain TEXT
    expect(roleLine).not.toMatch(/^"role"\s+TEXT\s/i);
    // Must use the role enum (DEFAULT can appear anywhere)
    expect(roleLine).toMatch(/^"role"\s+"role"/i);
  });
});

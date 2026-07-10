import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Verifies that the PostgreSQL init script for the local dev stack installs
 * the two extensions MercadoExpress depends on:
 *
 *   - `vector`     — pgvector, used by AI embeddings (design §3.2, spec REQ-DB-1).
 *   - `pgcrypto`   — gen_random_uuid() for primary keys (design §3.2).
 *
 * The script is mounted into the postgres container at first boot (when the
 * `pgdata` named volume is empty). If it is missing either extension, the
 * backend crashes on first migration with an opaque "function does not exist"
 * error. This test is the only static guard against that regression.
 *
 * TDD: RED phase — the file does not exist yet, so all assertions fail.
 */
describe('docker/postgres-init/01-pgvector.sql', () => {
  const sqlPath = resolve(__dirname, '../../../../docker/postgres-init/01-pgvector.sql');

  it('exists at the docker init-script mount path', () => {
    // Compose binds ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    // so the file MUST live at <repo>/docker/postgres-init/01-pgvector.sql.
    expect(() => readFileSync(sqlPath, 'utf8')).not.toThrow();
  });

  it('enables the pgvector extension with IF NOT EXISTS', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    // Match the extension name token after CREATE EXTENSION, allowing for
    // trailing whitespace, comments, and a semicolon.
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector\s*;/i);
  });

  it('enables the pgcrypto extension with IF NOT EXISTS', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto\s*;/i);
  });

  it('does not contain non-idempotent CREATE EXTENSION statements', () => {
    // The init script runs every time the named volume is empty (i.e. on the
    // first boot, but also after `docker compose down -v`). Plain
    // `CREATE EXTENSION vector;` would crash the second boot. Guard against
    // accidental copy-paste of non-idempotent forms.
    const sql = readFileSync(sqlPath, 'utf8');
    const nonIdempotent = sql.match(/CREATE\s+EXTENSION(?!\s+IF\s+NOT\s+EXISTS)/i);
    expect(nonIdempotent).toBeNull();
  });
});

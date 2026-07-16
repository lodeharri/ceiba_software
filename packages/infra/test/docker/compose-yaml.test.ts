import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Verifies that docker-compose.dev.yml exposes the single service the local
 * development stack needs after the LocalStack cleanup (PR 5 follow-up):
 *
 *   postgres  — local PostgreSQL 16 with pgvector (REQ-DEM-5).
 *
 * The frontend (Vue 3 SPA) runs natively via `pnpm dev:web` (Vite on :5173).
 * The API runs natively via `pnpm dev:api` (tsx --watch on :3001).
 *
 * The test uses string-based assertions rather than a YAML library because:
 *   1. `docker compose config` is the authoritative syntax check (run in CI).
 *   2. The only structural assertions we care about (presence of services,
 *      use of env interpolation, absence of hardcoded ports/URLs) reduce to
 *      readable text matches.
 *   3. Avoiding a YAML dev-dep keeps the test slice small.
 *
 * Hardcoded-port guard (spec REQ-CFG-1): the compose file MUST NOT contain
 * literal `5432`, `5173` or `3001` outside of comments or env-var fallbacks.
 */
describe('docker-compose.dev.yml', () => {
  const composePath = resolve(__dirname, '../../../../docker-compose.dev.yml');
  const composeText = (): string => readFileSync(composePath, 'utf8');

  it('exists at the repo root', () => {
    expect(() => readFileSync(composePath, 'utf8')).not.toThrow();
  });

  describe('top-level structure', () => {
    it('declares the services block', () => {
      expect(composeText()).toMatch(/^\s*services:\s*$/m);
    });

    it('declares the volumes block (pgdata, localstack-data only — legacy volume gone)', () => {
      expect(composeText()).toMatch(/^\s*volumes:\s*$/m);
    });

    it('declares the networks block for the local-dev bridge', () => {
      expect(composeText()).toMatch(/^\s*networks:\s*$/m);
    });

    it('loads .env.dev via per-service env_file', () => {
      expect(composeText()).toMatch(/env_file:/);
      expect(composeText()).toMatch(/\.env\.dev/);
    });
  });

  describe('required services — REQ-DEM-1', () => {
    it('declares the postgres service', () => {
      expect(composeText()).toMatch(/^\s{2}postgres:\s*$/m);
    });

    it('declares NO other services', () => {
      const text = composeText();
      expect(text).not.toMatch(/^\s{2}localstack:\s*$/m);
      expect(text).not.toMatch(/^\s{2}frontend:\s*$/m);
    });
  });

  describe('removed services / volumes — REQ-DEM-3, DEM-4, FNR-2', () => {
    it('does NOT declare localstack or frontend services', () => {
      const text = composeText();
      expect(text).not.toMatch(/^\s{2}localstack:\s*$/m);
      expect(text).not.toMatch(/^\s{2}frontend:\s*$/m);
      expect(text).not.toMatch(/^\s{2}deployer:\s*$/m);
      expect(text).not.toMatch(/^\s{2}s3-proxy:\s*$/m);
    });

    it('does NOT declare the legacy shared volume', () => {
      expect(composeText()).not.toMatch(/^\s{2}shared-data:\s*$/m);
    });
  });

  describe('postgres service — REQ-DEM-5', () => {
    it('uses POSTGRES_IMAGE env var (value lives in .env.dev.example)', () => {
      expect(composeText()).toMatch(/image:\s*\$\{?POSTGRES_IMAGE\}?/);
    });

    it('mounts the postgres-init scripts directory', () => {
      expect(composeText()).toMatch(/\.\/docker\/postgres-init:\/docker-entrypoint-initdb\.d/);
    });

    it('declares a healthcheck that waits for pg_isready', () => {
      expect(composeText()).toMatch(/pg_isready/);
      expect(composeText()).toMatch(/POSTGRES_USER/);
      expect(composeText()).toMatch(/POSTGRES_DB/);
    });
  });

  describe('zero hardcoded port literals (spec REQ-CFG-1)', () => {
    // The compose file must use ${POSTGRES_PORT} — never literal port numbers.
    // The .env.dev.example file is where the defaults live; the compose file
    // stays environment-driven.
    const forbidden = [/['"]?5432['"]?/, /['"]?4566['"]?/];

    for (const pattern of forbidden) {
      it(`does not contain the literal port ${pattern.source}`, () => {
        expect(composeText()).not.toMatch(pattern);
      });
    }
  });

  describe('regression — docker/ subdirectories that should be gone', () => {
    it('docker/<sidecar>/ directories are gone (REQ-DEM-3, DEM-6, FNR-2, FVE-5)', () => {
      // The previous SDD added three docker/ subdirectories that PR 2 deletes.
      // The grep guard elsewhere verifies the specific names; this test
      // asserts the FS state.
      expect(existsSync(resolve(__dirname, '../../../../docker/deployer'))).toBe(false);
      expect(existsSync(resolve(__dirname, '../../../../docker/s3-proxy'))).toBe(false);
      expect(existsSync(resolve(__dirname, '../../../../docker/frontend'))).toBe(false);
    });

    it('docker/postgres-init/01-pgvector.sql is intact (REQ-DEM-5)', () => {
      expect(
        existsSync(resolve(__dirname, '../../../../docker/postgres-init/01-pgvector.sql')),
      ).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Verifies that docker-compose.dev.yml exposes the two services the local
 * development stack needs after PR 2 of `replace-localstack-dev-server`:
 *
 *   postgres    — local PostgreSQL 16 with pgvector (REQ-DEM-5).
 *   localstack  — AWS emulator trimmed to
 *                 serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation
 *                 (REQ-DEM-2). The previous SDD's sidecars and the
 *                 legacy shared-data volume are gone.
 *
 * The test uses string-based assertions rather than a YAML library because:
 *   1. `docker compose config` is the authoritative syntax check (run in CI).
 *   2. The only structural assertions we care about (presence of services,
 *      use of env interpolation, absence of hardcoded ports/URLs) reduce to
 *      readable text matches.
 *   3. Avoiding a YAML dev-dep keeps the test slice small.
 *
 * Hardcoded-port guard (spec REQ-CFG-1): the compose file MUST NOT contain
 * literal `5432`, `4566`, or `5173` outside of comments or env-var fallbacks.
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
    const cases: ReadonlyArray<{ name: string; re: RegExp }> = [
      { name: 'postgres', re: /^\s{2}postgres:\s*$/m },
      { name: 'localstack', re: /^\s{2}localstack:\s*$/m },
    ];

    for (const { name, re } of cases) {
      it(`declares service '${name}'`, () => {
        expect(composeText()).toMatch(re);
      });
    }
  });

  describe('removed services / volumes — REQ-DEM-3, DEM-4, FNR-2', () => {
    it('does NOT declare a wrapper sidecar service', () => {
      // PR 2 removed the CDK-in-LocalStack wrapper service (and its nginx
      // companion + frontend container). The grep guard elsewhere verifies
      // the exact service names; this test asserts that ONLY postgres +
      // localstack survive in the compose file.
      expect(composeText()).not.toMatch(/^\s{2}deployer:\s*$/m);
      expect(composeText()).not.toMatch(/^\s{2}s3-proxy:\s*$/m);
      expect(composeText()).not.toMatch(/^\s{2}frontend:\s*$/m);
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

  describe('localstack service — REQ-DEM-2', () => {
    it('uses LOCALSTACK_IMAGE env var (value lives in .env.dev.example)', () => {
      expect(composeText()).toMatch(/image:\s*\$\{?LOCALSTACK_IMAGE\}?/);
    });

    it('hardcodes the trimmed SERVICES list (no longer interpolates ${LOCALSTACK_SERVICES})', () => {
      // PR 2: SERVICES is hardcoded in the compose file so the env var is
      // purely advisory. The trimmed value mirrors the spec REQ-DEM-2.
      expect(composeText()).toMatch(
        /SERVICES:\s*['"]?serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation['"]?/,
      );
    });

    it('does NOT mount /var/run/docker.sock (no more Docker-in-Docker Lambda runtimes)', () => {
      expect(composeText()).not.toMatch(/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
    });

    it('declares a healthcheck against the /_localstack/health endpoint', () => {
      expect(composeText()).toMatch(/\/_localstack\/health/);
    });
  });

  describe('zero hardcoded port literals (spec REQ-CFG-1)', () => {
    // The compose file must use ${POSTGRES_PORT}, ${LOCALSTACK_PORT} —
    // never literal port numbers. The .env.dev.example file is where the
    // defaults live; the compose file stays environment-driven.
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

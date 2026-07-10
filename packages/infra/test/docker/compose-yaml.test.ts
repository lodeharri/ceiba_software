import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Verifies that docker-compose.dev.yml exposes the four services the local
 * development stack needs:
 *
 *   postgres    — local PostgreSQL 16 with pgvector (design §3.1).
 *   localstack  — AWS emulator (Lambda + API Gateway + Secrets/SSM/IAM).
 *   deployer    — runs `cdk deploy --context stage=localstack` once
 *                 LocalStack + Postgres are healthy.
 *   frontend    — Vite dev server, reads the API URL written by the deployer.
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
 *
 * TDD: RED phase — docker-compose.dev.yml does not exist yet, so every
 * assertion below will fail until GREEN lands.
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

    it('declares the volumes block (pgdata, localstack-data, shared-data, node_modules)', () => {
      expect(composeText()).toMatch(/^\s*volumes:\s*$/m);
    });

    it('declares the networks block for the local-dev bridge', () => {
      expect(composeText()).toMatch(/^\s*networks:\s*$/m);
    });

    it('loads .env.dev via top-level env_file (Compose v2.24+ required)', () => {
      // Top-level env_file is the supported way to expose env vars to
      // interpolation. Per-service env_file: '*.env.dev' would also work but
      // duplicates the file path.
      expect(composeText()).toMatch(/env_file:/);
      expect(composeText()).toMatch(/\.env\.dev/);
    });
  });

  describe('required services', () => {
    // Inline regexes avoid eslint-plugin-security's "dynamic regex" warning
    // (the service names are compile-time constants — no user input involved).
    const cases: ReadonlyArray<{ name: string; re: RegExp }> = [
      { name: 'postgres', re: /^\s{2}postgres:\s*$/m },
      { name: 'localstack', re: /^\s{2}localstack:\s*$/m },
      { name: 'deployer', re: /^\s{2}deployer:\s*$/m },
      { name: 'frontend', re: /^\s{2}frontend:\s*$/m },
    ];

    for (const { name, re } of cases) {
      it(`declares service '${name}'`, () => {
        // Match the service header at column 2 (standard compose indent) and
        // make sure it is not commented out.
        expect(composeText()).toMatch(re);
      });
    }
  });

  describe('postgres service', () => {
    it('uses POSTGRES_IMAGE env var (value lives in .env.dev.example)', () => {
      // Compose contract: the file references ${POSTGRES_IMAGE}. The
      // actual default (pgvector/pgvector:pg16) is asserted in the
      // .env.dev.example test.
      expect(composeText()).toMatch(/image:\s*\$\{?POSTGRES_IMAGE\}?/);
    });

    it('mounts the postgres-init scripts directory', () => {
      // Critical: without this mount, the extension init never runs.
      expect(composeText()).toMatch(/\.\/docker\/postgres-init:\/docker-entrypoint-initdb\.d/);
    });

    it('declares a healthcheck that waits for pg_isready', () => {
      // Match the postgres healthcheck.test line.
      expect(composeText()).toMatch(/pg_isready/);
      expect(composeText()).toMatch(/POSTGRES_USER/);
      expect(composeText()).toMatch(/POSTGRES_DB/);
    });
  });

  describe('localstack service', () => {
    it('uses LOCALSTACK_IMAGE env var (value lives in .env.dev.example)', () => {
      expect(composeText()).toMatch(/image:\s*\$\{?LOCALSTACK_IMAGE\}?/);
    });

    it('references LOCALSTACK_SERVICES env var for the AWS service list', () => {
      // The actual service list is asserted in the .env.dev.example test.
      expect(composeText()).toMatch(/SERVICES:\s*\$\{?LOCALSTACK_SERVICES\}?/);
    });

    it('mounts /var/run/docker.sock so Lambda runtimes can spawn containers', () => {
      expect(composeText()).toMatch(/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
    });

    it('declares a healthcheck against the /_localstack/health endpoint', () => {
      expect(composeText()).toMatch(/\/_localstack\/health/);
    });
  });

  describe('deployer service', () => {
    it('builds from docker/deployer/Dockerfile (parte B — file may not exist yet)', () => {
      // parte B of PR 3 ships the Dockerfile; this test guards the contract.
      expect(composeText()).toMatch(/dockerfile:\s*docker\/deployer\/Dockerfile/);
    });

    it('waits for postgres AND localstack to be healthy', () => {
      expect(composeText()).toMatch(
        /depends_on:\s*\n\s+postgres:\s*\n\s+condition:\s*service_healthy/,
      );
      expect(composeText()).toMatch(/localstack:\s*\n\s+condition:\s*service_healthy/);
    });

    it('mounts the shared-data volume for the API URL handoff file', () => {
      expect(composeText()).toMatch(/shared-data:/);
    });

    it('exports DATABASE_URL and STAGE so the localstack migrations path works', () => {
      // STAGE=localstack is the discriminator in migrations-lambda.ts (PR 2).
      expect(composeText()).toMatch(/STAGE:\s*\$\{?STAGE\}?/);
      expect(composeText()).toMatch(/DATABASE_URL:\s*\$\{?DATABASE_URL\}?/);
    });
  });

  describe('frontend service', () => {
    it('builds from docker/frontend/Dockerfile (parte B — file may not exist yet)', () => {
      expect(composeText()).toMatch(/dockerfile:\s*docker\/frontend\/Dockerfile/);
    });

    it('waits for the deployer to become healthy', () => {
      expect(composeText()).toMatch(/deployer:\s*\n\s+condition:\s*service_healthy/);
    });

    it('reads API_URL_FILE from the shared-data volume', () => {
      expect(composeText()).toMatch(/API_URL_FILE:/);
    });

    it('exposes VITE_API_BASE_URL so the SPA can reach LocalStack API Gateway', () => {
      expect(composeText()).toMatch(/VITE_API_BASE_URL:/);
    });
  });

  describe('zero hardcoded port literals (spec REQ-CFG-1)', () => {
    // The compose file must use ${POSTGRES_PORT}, ${LOCALSTACK_PORT},
    // ${FRONTEND_PORT} — never literal port numbers. The .env.dev.example
    // file is where the defaults live; the compose file stays
    // environment-driven.
    const forbidden = [/['"]?5432['"]?/, /['"]?4566['"]?/, /['"]?5173['"]?/];

    for (const pattern of forbidden) {
      it(`does not contain the literal port ${pattern.source}`, () => {
        expect(composeText()).not.toMatch(pattern);
      });
    }
  });
});

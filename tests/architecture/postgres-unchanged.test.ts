/**
 * postgres + pgvector regression guard (Task 2.3; PR 2 — REQ-DEM-5).
 *
 * After trimming `docker-compose.dev.yml` to two services (postgres +
 * localstack), the postgres service definition MUST remain functionally
 * identical to the pre-change version: same image (pgvector/pgvector:pg16),
 * same healthcheck (pg_isready), same initdb.d mount that installs the
 * pgvector extension via `01-pgvector.sql`. Removing or breaking the
 * pgvector install would break every Lambda handler that reads embeddings.
 *
 * This test reads the file as text and checks targeted invariants. We
 * avoid pulling in a YAML parser as a dep just for these checks; the
 * compose file is small and our author-controlled, so a string-based
 * invariant is sufficient and dependency-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const COMPOSE_FILE = resolve(ROOT, 'docker-compose.dev.yml');
const TSCONFIG_FILE = resolve(ROOT, 'packages/frontend/tsconfig.node.json');

const composeText = readFileSync(COMPOSE_FILE, 'utf8');
const envExampleText = readFileSync(resolve(ROOT, '.env.dev.example'), 'utf8');

/** Extract the `services:` block as a slice, returning the raw text. */
function servicesBlock(): string {
  // Match from `^services:` to the next top-level key (`networks:` or
  // `volumes:` at 0-space indent). Service bodies also contain their own
  // `volumes:` keys, so we must anchor on 0-space indent specifically.
  // The lookahead `\n[a-z]+:` matches a newline followed by a top-level
  // key at column 0; it does NOT match newlines inside indented blocks
  // (which are followed by spaces). This avoids the multiline-mode trap
  // where `$` matches at every end-of-line and stops the lazy capture
  // prematurely.
  const re = /^services:\n[\s\S]*?(?=\n[a-z]+:)/m;
  const match = composeText.match(re);
  return match?.[0] ?? '';
}

/** Extract a service block by name (top-level two-space indent). */
function serviceBlock(name: string): string {
  const services = servicesBlock();
  // The services: header is followed by indented blocks at 2 spaces. A
  // service body contains lines indented at 4 or more spaces. We stop at
  // the next line that is exactly 2-space-indented (the next service).
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^  ${escaped}:\\n(?: {4,}.*\\n)*`, 'm');
  const match = services.match(re);
  return match?.[0] ?? '';
}

describe('docker-compose.dev.yml — REQ-DEM-5 (postgres service unchanged)', () => {
  it('declares the postgres service', () => {
    expect(serviceBlock('postgres')).toMatch(/^ {2}postgres:/m);
  });

  it('uses the pgvector-flavored postgres image (POSTGRES_IMAGE env var)', () => {
    const pg = serviceBlock('postgres');
    expect(pg).toMatch(/image: \$\{POSTGRES_IMAGE\}/);
    // Sanity check the env file default keeps pgvector.
    expect(envExampleText).toMatch(/^POSTGRES_IMAGE=pgvector\/pgvector:pg16$/m);
  });

  it('defines a healthcheck using pg_isready', () => {
    const pg = serviceBlock('postgres');
    expect(pg).toMatch(/healthcheck:/);
    expect(pg).toMatch(/pg_isready/);
    expect(pg).toMatch(/CMD-SHELL/);
  });

  it('mounts the docker/postgres-init directory into /docker-entrypoint-initdb.d', () => {
    const pg = serviceBlock('postgres');
    expect(pg).toMatch(/\.\/docker\/postgres-init:\/docker-entrypoint-initdb\.d:ro/);
  });

  it('keeps the pgdata named volume', () => {
    expect(composeText).toMatch(/^ {2}pgdata:\n {4}name: \$\{POSTGRES_VOLUME_NAME\}/m);
  });
});

describe('docker-compose.dev.yml — REQ-DEM-3 / DEM-4 / FNR-2 (no sidecars)', () => {
  it('does NOT declare a deployer service', () => {
    expect(serviceBlock('deployer')).toBe('');
    expect(composeText).not.toMatch(/^ {2}deployer:/m);
  });

  it('does NOT declare an s3-proxy service', () => {
    expect(serviceBlock('s3-proxy')).toBe('');
    expect(composeText).not.toMatch(/^ {2}s3-proxy:/m);
  });

  it('does NOT declare a frontend service (REQ-FNR-2)', () => {
    expect(serviceBlock('frontend')).toBe('');
    expect(composeText).not.toMatch(/^ {2}frontend:/m);
  });

  it('does NOT declare a shared-data named volume', () => {
    expect(composeText).not.toMatch(/^ {2}shared-data:/m);
  });

  it('does NOT reference shared-data in any service volume mount', () => {
    const services = servicesBlock();
    expect(services).not.toMatch(/shared-data/);
  });
});

describe('packages/frontend/tsconfig.node.json — REQ-FVE-4 sanity', () => {
  it('does NOT reference docker/frontend in any include entry (deleted dir)', () => {
    const tsconfig = readFileSync(TSCONFIG_FILE, 'utf8');
    expect(tsconfig).not.toMatch(/docker\/frontend/);
  });

  it('lists vite.config.ts and vite-env.ts in include (covers the dev-mode compile scope)', () => {
    let parsed: { include?: string[] };
    try {
      parsed = JSON.parse(readFileSync(TSCONFIG_FILE, 'utf8')) as {
        include?: string[];
      };
    } catch (e) {
      throw new Error(`Failed to parse tsconfig.node.json: ${String(e)}`);
    }
    const include = parsed.include ?? [];
    expect(include).toContain('vite.config.ts');
    expect(include).toContain('vite-env.ts');
  });
});

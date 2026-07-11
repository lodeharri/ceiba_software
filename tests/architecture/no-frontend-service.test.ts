/**
 * `docker compose --services` does NOT declare `frontend` (Tasks 2.5, 4.1; PR 2).
 *
 * Locks the contract that the trimmed compose file exposes exactly two
 * services (`postgres` + `localstack`). The previous SDD
 * (`add-localstack-dev-env`) added a `frontend` service that bind-mounted
 * the source tree for Vite HMR; with the wrapper-native dev server (REQ-NDS-*)
 * and `pnpm dev:web` (REQ-FNR-1) replacing it, the frontend now runs NATIVELY
 * and is intentionally absent from `docker compose config --services`.
 *
 * REQ-FNR-2 — no `frontend` service entry in `docker-compose.dev.yml`.
 *
 * This is a focused single-purpose companion to `compose-services.test.ts`
 * (which checks the full service set + SERVICES env binding). We shell out
 * to `docker compose config --services` because that is the authoritative
 * list Docker would actually start, not just the YAML surface — the
 * architecturally truthful assertion for "frontend is not a containerized
 * service anymore".
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const COMPOSE_FILE = resolve(ROOT, 'docker-compose.dev.yml');
const ENV_FILE = resolve(ROOT, '.env.dev.example');

/** Run `docker compose ...` deterministically. */
function dockerCompose(args: string[]): string {
  return execFileSync('docker', ['compose', '--env-file', ENV_FILE, '-f', COMPOSE_FILE, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function services(): string[] {
  const out = dockerCompose(['config', '--services']);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe('docker-compose.dev.yml — REQ-FNR-2 (no frontend service)', () => {
  it('does NOT declare a `frontend` service', () => {
    const list = services();
    expect(list).not.toContain('frontend');
  });

  it('declares exactly the postgres + localstack pair (sanity companion)', () => {
    // Re-asserts the two-service contract from compose-services.test.ts but
    // scoped to the frontend-removal property. Catches a regression where
    // someone adds `frontend` back while keeping `postgres` + `localstack`.
    expect(services().sort()).toEqual(['localstack', 'postgres']);
  });
});

/**
 * docker-compose.dev.yml service surface (Tasks 2.1, 2.5; PR 2).
 *
 * Locks the contract that docker-compose.dev.yml declares exactly one
 * service: `postgres`. The previous SDD (`add-localstack-dev-env`) added
 * a `localstack` service plus a `deployer` service that wrapped CDK-in-
 * LocalStack, an `s3-proxy` nginx sidecar, and a `frontend` service.
 * All are gone after the LocalStack cleanup (PR 5 follow-up): the
 * frontend runs natively via `pnpm dev:web` (Vite on :5174) and the API
 * runs via `pnpm dev:api` (tsx --watch on :3001).
 *
 * REQ-DEM-1 — exactly one service (postgres).
 * REQ-DEM-3 — no deployer/s3-proxy/frontend/localstack containers.
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
  const stdout = execFileSync(
    'docker',
    ['compose', '--env-file', ENV_FILE, '-f', COMPOSE_FILE, ...args],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return stdout;
}

describe('docker-compose.dev.yml — REQ-DEM-1 (services)', () => {
  it('declares exactly one service: postgres', () => {
    const out = dockerCompose(['config', '--services']);
    const services = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort();
    expect(services).toEqual(['postgres']);
  });

  it('does NOT declare deployer, s3-proxy, frontend, redis, pgadmin, or any other service', () => {
    const out = dockerCompose(['config', '--services']);
    const services = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const forbidden of ['deployer', 's3-proxy', 'redis', 'pgadmin']) {
      expect(services).not.toContain(forbidden);
    }
  });
});

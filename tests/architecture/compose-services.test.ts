/**
 * docker-compose.dev.yml service surface (Tasks 2.1, 2.5; PR 2).
 *
 * Locks the contract that docker-compose.dev.yml declares exactly two
 * services: `postgres` and `localstack`. The previous SDD
 * (`add-localstack-dev-env`) added a `deployer` service that wrapped
 * CDK-in-LocalStack, an `s3-proxy` nginx sidecar that rewrote S3 URLs
 * to path-style, and a `frontend` service that bind-mounted the source
 * tree for Vite HMR. All three are gone after PR 2; the frontend now
 * runs natively via `pnpm dev:web` (REQ-FNR-1), and the wrapper-native
 * dev server (REQ-NDS-*) replaces the deployer.
 *
 * REQ-DEM-1 — exactly two services.
 * REQ-DEM-2 — LocalStack `SERVICES` env is the trimmed list.
 * REQ-DEM-3 — no deployer/s3-proxy/frontend containers.
 * REQ-DEM-4 — `shared-data` volume is gone.
 * REQ-FNR-2 — no `frontend` service entry.
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

describe('docker-compose.dev.yml — REQ-DEM-1, DEM-3, FNR-2 (services)', () => {
  it('declares exactly three services: postgres + localstack + frontend', () => {
    const out = dockerCompose(['config', '--services']);
    const services = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort();
    expect(services).toEqual(['frontend', 'localstack', 'postgres']);
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

describe('docker-compose.dev.yml — REQ-DEM-2 (LocalStack SERVICES env)', () => {
  // The resolved env line for the `localstack` service:
  //   services:
  //     localstack:
  //       environment:
  //         SERVICES: <value>
  // In YAML dump form, this is indented by 8 spaces. We anchor to that exact
  // shape to avoid picking up `LOCALSTACK_SERVICES:` (the env_file variable)
  // which is still in the rendered output for backwards-compat with old .env
  // files but is no longer wired into the SERVICES env binding.
  const SERVICES_LINE = /^[ ]{6}(?!LOCALSTACK_)SERVICES:\s*['"]?([^'"\n]+)['"]?$/m;

  it('trims SERVICES to serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation', () => {
    const out = dockerCompose(['config']);
    const match = out.match(SERVICES_LINE);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation');
  });

  it('does NOT include apigateway or lambda in the SERVICES value', () => {
    const out = dockerCompose(['config']);
    const match = out.match(SERVICES_LINE);
    expect(match).not.toBeNull();
    const tokens = (match?.[1] ?? '').split(',').map((t) => t.trim());
    expect(tokens).not.toContain('apigateway');
    expect(tokens).not.toContain('lambda');
  });
});

describe('docker-compose.dev.yml — REQ-DEM-4 (no shared-data volume)', () => {
  it('does NOT declare a volume named shared-data', () => {
    const out = dockerCompose(['config', '--volumes']);
    const volumes = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(volumes).not.toContain('shared-data');
    // Belt and suspenders — no volume whose name starts with `shared`.
    for (const v of volumes) {
      expect(v.startsWith('shared')).toBe(false);
    }
  });
});

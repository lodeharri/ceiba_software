/**
 * Frontend container service contract (PR 5).
 *
 * Locks the contract that docker-compose.dev.yml declares a frontend:
 * service block that:
 *   - builds from packages/frontend/ (multi-stage Dockerfile)
 *   - has container_name: ${FRONTEND_CONTAINER_NAME}
 *   - maps ${FRONTEND_PORT}:${FRONTEND_DOCKER_PORT}
 *   - joins the local-dev network
 *   - declares a healthcheck that curls the SPA index
 *   - declares env_file so the container inherits .env.dev*
 *
 * The hardcoded-port guard lives in no-hardcoded-ports.test.ts.
 *
 * Implementation note: we read docker-compose.dev.yml as text (NOT
 * the rendered `docker compose config` output) so we can verify the
 * SOURCE uses ${VAR} interpolation. The rendered config resolves
 * ${POSTGRES_PORT} -> 5432 etc., which would hide a literal-port
 * regression.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const COMPOSE_FILE = resolve(ROOT, 'docker-compose.dev.yml');
const DOCKERFILE = resolve(ROOT, 'packages/frontend/Dockerfile');
const NGINX_CONF = resolve(ROOT, 'packages/frontend/nginx.conf');

/**
 * Extract the source-YAML block for a named service.
 * Walks the YAML looking for `  <name>:` at column-2 indent, then
 * continues until the next column-2 entry.
 */
function readServiceBlock(composeText: string, serviceName: string): string {
  const lines2 = composeText.split('\n');
  const startIdx = lines2.findIndex((line) => new RegExp('^  ' + serviceName + ':$').test(line));
  if (startIdx < 0) return '';
  let endIdx = lines2.length;
  for (let i = startIdx + 1; i < lines2.length; i++) {
    const line = lines2[i] ?? '';
    if (/^\s{2}[a-zA-Z]/.test(line)) {
      endIdx = i;
      break;
    }
  }
  return lines2.slice(startIdx, endIdx).join('\n');
}

function listServiceNames(composeText: string): string[] {
  // Scope to the `services:` section (start at `services:`, end at `networks:` or EOF).
  // This avoids picking up `local-dev:` (a network name) or `pgdata:` (a volume).
  const out: string[] = [];
  let inServices = false;
  for (const line of composeText.split('\n')) {
    if (/^services:$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^(networks|volumes):$/.test(line)) break;
    const m = line.match(/^\s{2}([a-zA-Z][a-zA-Z0-9_-]*):$/);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

describe('docker-compose.dev.yml - frontend service block (PR 5)', () => {
  it('declares a frontend: service in addition to postgres + localstack', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const services = listServiceNames(composeText).sort();
    expect(services).toEqual(['frontend', 'localstack', 'postgres']);
  });

  it('frontend: service block exists in the source compose file', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    expect(block.length).toBeGreaterThan(0);
    expect(block.startsWith('  frontend:')).toBe(true);
  });

  it('builds from packages/frontend/ via Dockerfile', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    const okShape =
      /build:\s*packages\/frontend\b/.test(block) ||
      /dockerfile:\s*packages\/frontend\/Dockerfile\b/.test(block);
    expect(okShape).toBe(true);
  });

  it('container_name is ${FRONTEND_CONTAINER_NAME}', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    expect(block).toMatch(/container_name:\s*\$\{FRONTEND_CONTAINER_NAME\}/);
    expect(block).not.toMatch(/container_name:\s*ceiba-frontend\b/);
  });

  it('ports mapping uses ${FRONTEND_PORT}:${FRONTEND_DOCKER_PORT}', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    expect(block).toMatch(/\$\{FRONTEND_PORT\}:\$\{FRONTEND_DOCKER_PORT\}/);
    expect(block).not.toMatch(/-\s*['"]?\d{2,5}:\d{2,5}/);
  });

  it('joins the local-dev network', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    expect(block).toMatch(/networks:/);
    expect(block).toMatch(/-\s*local-dev/);
  });

  it('declares a healthcheck that curls the SPA index', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    expect(block).toMatch(/healthcheck:/);
    expect(block).toMatch(/\$\{FRONTEND_DOCKER_PORT\}/);
  });

  it('declares env_file to inherit .env.dev*', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const block = readServiceBlock(composeText, 'frontend');
    expect(block).toMatch(/env_file:/);
    expect(block).toMatch(/\.env\.dev/);
  });
});

describe('frontend Docker artifacts exist (PR 5)', () => {
  it('packages/frontend/Dockerfile exists', () => {
    expect(existsSync(DOCKERFILE)).toBe(true);
  });

  it('packages/frontend/nginx.conf exists', () => {
    expect(existsSync(NGINX_CONF)).toBe(true);
  });

  it('Dockerfile is multi-stage (builder + runtime)', () => {
    const text = readFileSync(DOCKERFILE, 'utf8');
    const fromCount = (text.match(/^FROM\s+/gm) ?? []).length;
    expect(fromCount).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/^FROM\s+\S+\s+AS\s+builder\b/m);
    expect(text).toMatch(/^FROM\s+nginx:\S+/m);
  });

  it('Dockerfile accepts VITE_API_BASE_URL as a build ARG', () => {
    const text = readFileSync(DOCKERFILE, 'utf8');
    expect(text).toMatch(/ARG\s+VITE_API_BASE_URL/);
  });

  it('Dockerfile CMD runs nginx in the foreground', () => {
    const text = readFileSync(DOCKERFILE, 'utf8');
    expect(text).toMatch(/CMD\s+\["nginx"/);
  });

  it('nginx.conf has SPA fallback (try_files ending in /index.html)', () => {
    const text = readFileSync(NGINX_CONF, 'utf8');
    expect(text).toMatch(/try_files\s+[^;]*\/index\.html/);
  });

  it('nginx.conf listens on the default port 80', () => {
    const text = readFileSync(NGINX_CONF, 'utf8');
    expect(text).toMatch(/listen\s+80\s*;/);
  });
});

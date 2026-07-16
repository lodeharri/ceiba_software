/**
 * Frontend container service contract (PR 5 follow-up).
 *
 * After the LocalStack cleanup, docker-compose.dev.yml NO LONGER declares a
 * frontend: service. The Vue 3 SPA runs natively via `pnpm dev:web` (Vite
 * on :5174). The Dockerfile and nginx.conf are KEPT because CDK's FrontendStack
 * uses them to build a production image for AWS deployment.
 *
 * REQ-FNR-2 — no `frontend` service entry in docker-compose.dev.yml.
 * REQ-FNR-3 — Dockerfile + nginx.conf exist (for AWS deploy, not local dev).
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

function listServiceNames(composeText: string): string[] {
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

describe('docker-compose.dev.yml - no frontend service (PR 5 follow-up)', () => {
  it('declares NO frontend: service', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const services = listServiceNames(composeText).sort();
    expect(services).not.toContain('frontend');
  });

  it('declares only postgres (no localstack either)', () => {
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const services = listServiceNames(composeText).sort();
    expect(services).toEqual(['postgres']);
  });
});

describe('frontend Docker artifacts exist for AWS deploy (PR 5)', () => {
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

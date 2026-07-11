/**
 * .env.dev.example - frontend container defaults (PR 5).
 *
 * Locks the contract that .env.dev.example declares the env vars
 * consumed by the new frontend: docker-compose service and by the
 * Vite SPA build:
 *   - FRONTEND_PORT                  (browser-facing; default 5173)
 *   - VITE_API_BASE_URL              (build-time API base URL)
 *   - FRONTEND_CONTAINER_NAME        (compose container_name)
 *   - FRONTEND_DOCKER_PORT           (in-container port nginx binds to)
 *   - FRONTEND_HEALTHCHECK_RETRIES   (compose healthcheck retries)
 *
 * Also asserts that no other FRONTEND_* keys exist that aren't wired
 * into compose (catches accidental orphans).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENV_FILE = resolve(ROOT, '.env.dev.example');
const COMPOSE_FILE = resolve(ROOT, 'docker-compose.dev.yml');
const ENV_VALIDATION = resolve(ROOT, 'packages/frontend/vite-plugins/env-validation.ts');

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out.set(key, value);
  }
  return out;
}

describe('.env.dev.example - frontend container defaults (PR 5)', () => {
  it('declares FRONTEND_CONTAINER_NAME=ceiba-frontend', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    expect(map.get('FRONTEND_CONTAINER_NAME')).toBe('ceiba-frontend');
  });

  it('declares FRONTEND_DOCKER_PORT (default 80 - nginx binds in-container)', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    expect(map.get('FRONTEND_DOCKER_PORT')).toBe('80');
  });

  it('declares FRONTEND_HEALTHCHECK_RETRIES (positive integer)', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    const value = map.get('FRONTEND_HEALTHCHECK_RETRIES') ?? '';
    expect(Number(value)).toBeGreaterThan(0);
  });

  it('declares FRONTEND_PORT (browser-facing; default 5173)', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    expect(map.get('FRONTEND_PORT')).toBe('5173');
  });

  it('declares VITE_API_BASE_URL pointing at the dev server', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    expect(map.get('VITE_API_BASE_URL')).toBe('http://localhost:3001/api/v1');
  });
});

describe('.env.dev.example - no orphan FRONTEND_* keys (PR 5)', () => {
  it('every FRONTEND_* key is wired into docker-compose.dev.yml', () => {
    const envText = readFileSync(ENV_FILE, 'utf8');
    const composeText = readFileSync(COMPOSE_FILE, 'utf8');
    const env = parseEnv(envText);
    const frontendKeys = [...env.keys()].filter((k) => k.startsWith('FRONTEND_'));
    expect(frontendKeys.length).toBeGreaterThan(0);

    for (const key of frontendKeys) {
      const interpolation = '${' + key + '}';
      expect(composeText).toContain(interpolation);
    }
  });

  it('VITE_API_BASE_URL is consumed by the env-validation Vite plugin', () => {
    const envValidation = readFileSync(ENV_VALIDATION, 'utf8');
    expect(envValidation).toMatch(/VITE_API_BASE_URL/);
  });
});

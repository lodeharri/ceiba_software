/**
 * .env.dev.example - frontend Vite defaults (PR 5).
 *
 * Locks the contract that .env.dev.example declares the env vars
 * consumed by the Vite SPA build:
 *   - FRONTEND_PORT                  (browser-facing; default 5173)
 *   - VITE_API_BASE_URL              (build-time API base URL)
 *
 * The nginx frontend container was removed in the LocalStack cleanup
 * (PR 5 follow-up). FRONTEND_CONTAINER_NAME, FRONTEND_DOCKER_PORT, and
 * FRONTEND_HEALTHCHECK_RETRIES are no longer declared.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENV_FILE = resolve(ROOT, '.env.dev.example');
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

describe('.env.dev.example - frontend Vite defaults (PR 5 follow-up)', () => {
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

  it('does NOT declare FRONTEND_CONTAINER_NAME (nginx container removed)', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    expect(map.has('FRONTEND_CONTAINER_NAME')).toBe(false);
  });

  it('does NOT declare FRONTEND_DOCKER_PORT (nginx container removed)', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const map = parseEnv(text);
    expect(map.has('FRONTEND_DOCKER_PORT')).toBe(false);
  });
});

describe('.env.dev.example - no orphan FRONTEND_* keys (PR 5 follow-up)', () => {
  it('every FRONTEND_* key is wired into vite.config.ts (not compose)', () => {
    const envText = readFileSync(ENV_FILE, 'utf8');
    const viteConfig = readFileSync(resolve(ROOT, 'packages/frontend/vite.config.ts'), 'utf8');
    const env = parseEnv(envText);
    const frontendKeys = [...env.keys()].filter((k) => k.startsWith('FRONTEND_'));
    expect(frontendKeys.length).toBeGreaterThan(0);

    for (const key of frontendKeys) {
      // The nginx compose service is gone; FRONTEND_PORT is now used by vite.config.ts.
      expect(viteConfig).toContain(key);
    }
  });

  it('VITE_API_BASE_URL is consumed by the env-validation Vite plugin', () => {
    const envValidation = readFileSync(ENV_VALIDATION, 'utf8');
    expect(envValidation).toMatch(/VITE_API_BASE_URL/);
  });
});

/**
 * `.env.development` declares `VITE_API_BASE_URL` (Task 6.6; PR 3 — REQ-FNR-3,
 * REQ-FVE-7).
 *
 * Locks the contract that:
 *   - `packages/frontend/.env.development` exists and is non-empty.
 *   - It defines `VITE_API_BASE_URL=http://localhost:3001/api/v1` (the dev
 *     server's mount path — see design.md §1 + native-dev-server spec).
 *   - Neither `.env.development` nor `.env.production` references the
 *     removed `s3-proxy` or `API_GATEWAY_HOST_EXTERNAL` tokens (REQ-FNR-3
 *     scenario 2).
 *   - Every `VITE_*` key in `.env.development` has a non-empty value (REQ-FVE-7).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENV_DEV = resolve(ROOT, 'packages/frontend/.env.development');
const ENV_PROD = resolve(ROOT, 'packages/frontend/.env.production');

function loadEnv(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

describe('.env.development declares VITE_API_BASE_URL (Task 6.6 — REQ-FNR-3, FVE-7)', () => {
  it('.env.development exists and is non-empty', () => {
    expect(existsSync(ENV_DEV)).toBe(true);
    const stat = statSync(ENV_DEV);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('.env.development sets VITE_API_BASE_URL=http://localhost:3001/api/v1', () => {
    const text = loadEnv(ENV_DEV) ?? '';
    // Tolerate trailing slash / comment / whitespace.
    expect(text).toMatch(/VITE_API_BASE_URL\s*=\s*http:\/\/localhost:3001\/api\/v1\b/);
  });

  it('.env.development has no s3-proxy reference', () => {
    const text = loadEnv(ENV_DEV) ?? '';
    expect(text).not.toMatch(/s3-proxy/);
  });

  it('.env.development has no API_GATEWAY_HOST_EXTERNAL reference', () => {
    const text = loadEnv(ENV_DEV) ?? '';
    expect(text).not.toMatch(/API_GATEWAY_HOST_EXTERNAL/);
  });

  it('.env.production (if present) has no s3-proxy or API_GATEWAY_HOST_EXTERNAL', () => {
    const text = loadEnv(ENV_PROD);
    if (text !== null) {
      expect(text).not.toMatch(/s3-proxy/);
      expect(text).not.toMatch(/API_GATEWAY_HOST_EXTERNAL/);
    }
  });

  it('every VITE_* key in .env.development has a non-empty value', () => {
    const text = loadEnv(ENV_DEV) ?? '';
    const activeLines = text
      .split('\n')
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .filter((line) => /^VITE_[A-Z0-9_]*\s*=/.test(line));
    expect(activeLines.length).toBeGreaterThan(0);
    for (const line of activeLines) {
      const eq = line.indexOf('=');
      const value = eq >= 0 ? line.slice(eq + 1).trim() : '';
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

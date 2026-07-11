/**
 * .env.dev.example stale-key cleanup guard (Task 2.4; PR 2 — REQ-EVC-1..4).
 *
 * Locks the contract that the tracked `.env.dev.example` file does NOT
 * define any of the removed keys (REQ-EVC-1), DOES still define the kept
 * keys (REQ-EVC-2), and has no commented-out stragglers that mention a
 * removed token (REQ-EVC-1 scenario 2).
 *
 * Scope: `.env.dev.example` ONLY (per the orchestrator's hard rule).
 * `.env.dev` is git-ignored and developer-personal; this test does not
 * touch it. Removing the stale keys from `.env.dev` is left to each
 * developer — `pnpm dev:up` would fail otherwise, so the local file will
 * be cleaned organically.
 *
 * The kept set (per the orchestrator's PR 2 task contract):
 *   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT,
 *   DATABASE_URL, LOCALSTACK_HOST, LOCALSTACK_PORT,
 *   LOCAL_DEV_NETWORK_NAME, AWS_REGION, AWS_ACCESS_KEY_ID,
 *   AWS_SECRET_ACCESS_KEY, STAGE, JWT_SECRET, JWT_SECRET_PREVIOUS,
 *   FRONTEND_PORT, VITE_API_BASE_URL.
 *
 * The removed set (per the spec + orchestrator):
 *   AWS_ENDPOINT_URL_S3, LOCALSTACK_BIND_HOST, LAMBDA_*, DEPLOYER_*,
 *   S3_PROXY_*, SHARED_DATA_DIR, API_URL_FILE, API_GATEWAY_HOST_EXTERNAL.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENV_FILE = resolve(ROOT, '.env.dev.example');

const envText = readFileSync(ENV_FILE, 'utf8');

/** Strip comments + blank lines, leaving only `KEY=value` lines. */
const activeLines = envText.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));

const activeKeys = new Set(
  activeLines
    .map((line) => line.split('=', 1)[0]?.trim() ?? '')
    .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key)),
);

const KEPT_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'DATABASE_URL',
  'LOCALSTACK_HOST',
  'LOCALSTACK_PORT',
  'LOCAL_DEV_NETWORK_NAME',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'STAGE',
  'JWT_SECRET',
  'JWT_SECRET_PREVIOUS',
  'FRONTEND_PORT',
  'VITE_API_BASE_URL',
];

const REMOVED_EXACT = [
  'AWS_ENDPOINT_URL_S3',
  'LOCALSTACK_BIND_HOST',
  'SHARED_DATA_DIR',
  'API_URL_FILE',
  'API_GATEWAY_HOST_EXTERNAL',
];

const REMOVED_PREFIX = ['LAMBDA_', 'DEPLOYER_', 'S3_PROXY_'];

describe('.env.dev.example — REQ-EVC-1 (no removed keys)', () => {
  for (const key of REMOVED_EXACT) {
    it(`does NOT define ${key}`, () => {
      expect(activeKeys.has(key)).toBe(false);
    });
  }

  for (const prefix of REMOVED_PREFIX) {
    it(`does NOT define any key with prefix ${prefix}`, () => {
      for (const key of activeKeys) {
        expect(key.startsWith(prefix)).toBe(false);
      }
    });
  }

  it('does NOT mention removed keys in commented-out lines (no commented stragglers)', () => {
    const commentLines = envText.split('\n').filter((line) => line.trimStart().startsWith('#'));
    const joined = commentLines.join('\n');
    for (const key of [...REMOVED_EXACT, ...REMOVED_PREFIX.map((p) => p.replace(/_$/, ''))]) {
      expect(joined).not.toContain(key);
    }
  });
});

describe('.env.dev.example — REQ-EVC-2 (kept keys present)', () => {
  for (const key of KEPT_KEYS) {
    it(`defines ${key}`, () => {
      expect(activeKeys.has(key)).toBe(true);
    });
  }

  it('VITE_API_BASE_URL points at the dev server (http://localhost:3001/api/v1)', () => {
    const line = activeLines.find((l) => l.startsWith('VITE_API_BASE_URL='));
    expect(line).toBeDefined();
    expect(line).toMatch(/^VITE_API_BASE_URL=http:\/\/localhost:3001\/api\/v1$/);
  });

  it('FRONTEND_PORT defaults to 5173 (Vite default)', () => {
    const line = activeLines.find((l) => l.startsWith('FRONTEND_PORT='));
    expect(line).toBeDefined();
    expect(line).toMatch(/^FRONTEND_PORT=5173$/);
  });
});

describe('.env.dev.example — REQ-EVC-4 (env file structure)', () => {
  it('declares no more than 30 active KEY=value lines (NFR-1 file size)', () => {
    expect(activeLines.length).toBeLessThanOrEqual(30);
  });

  it('LOCALSTACK_SERVICES (if defined) trims out apigateway and lambda', () => {
    // The spec drops the SERVICES interpolation; if .env.dev.example still
    // declares it (for backwards-compat with old `.env.dev` files that
    // reference `${LOCALSTACK_SERVICES}`), it MUST NOT include apigateway
    // or lambda. The trimmed compose hardcodes the SERVICES value, so the
    // env-file value is advisory only.
    const line = activeLines.find((l) => l.startsWith('LOCALSTACK_SERVICES='));
    if (line) {
      expect(line).not.toMatch(/apigateway/);
      expect(line).not.toMatch(/lambda/);
    }
  });
});

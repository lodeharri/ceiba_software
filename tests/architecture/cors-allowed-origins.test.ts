/**
 * CORS contract - front origin accepted by dev server (PR 5).
 *
 * Locks REQ-NDS-7 + the cross-cutting CORS contract for the new
 * SPA-in-Docker flow. PR 5 keeps the front on :5173 (browser-facing)
 * but moves the serving to nginx inside a container; the dev server
 * is unchanged. This test verifies the contract is intact for the new
 * flow:
 *   1. scripts/dev-server.ts continues to set
 *      Access-Control-Allow-Origin to * OR to ${FRONTEND_ORIGIN}.
 *   2. The Allow-Methods + Allow-Headers lists cover what the SPA uses.
 *   3. The front's effective origin (built from FRONTEND_PORT) is
 *      well-formed and matches the dev server's policy.
 *   4. The OPTIONS preflight short-circuit (PR 1) was not removed by
 *      any PR 5 refactor.
 *
 * This is a documentation/regression guard: production behaviour is
 * already correct (the dev server's * policy accepts any origin),
 * but the test catches accidental refactors that break the
 * cross-cutting flow.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DEV_SERVER = resolve(ROOT, 'scripts/dev-server.ts');
const VITE_CONFIG = resolve(ROOT, 'packages/frontend/vite.config.ts');
const ENV_EXAMPLE = resolve(ROOT, '.env.dev.example');
const HTTP_TS = resolve(ROOT, 'packages/frontend/src/services/http.ts');

function envValue(file: string, key: string): string | undefined {
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(key + '=')) {
      const idx = trimmed.indexOf('=');
      return idx >= 0 ? trimmed.slice(idx + 1).trim() : undefined;
    }
  }
  return undefined;
}

describe('CORS contract - front origin accepted by dev server (PR 5)', () => {
  it('scripts/dev-server.ts sets Access-Control-Allow-Origin to * or ${FRONTEND_ORIGIN}', () => {
    const text = readFileSync(DEV_SERVER, 'utf8');
    const wildcard = /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/;
    const interpolated = /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\$\{FRONTEND_ORIGIN\}['"]/;
    expect(wildcard.test(text) || interpolated.test(text)).toBe(true);
  });

  it('Access-Control-Allow-Methods const covers the verbs the SPA uses', () => {
    const text = readFileSync(DEV_SERVER, 'utf8');
    // The allowlist is defined as a constant (ALLOW_METHODS = 'GET, POST, ...'),
    // so we read the const line directly rather than the headers object.
    const constLine = text.split('\n').find((l) => /ALLOW_METHODS\s*=\s*['"]/.test(l.trim()));
    expect(constLine).toBeDefined();
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(constLine).toContain(verb);
    }
  });

  it('Access-Control-Allow-Headers const covers Authorization + Content-Type + X-Request-Id', () => {
    const text = readFileSync(DEV_SERVER, 'utf8');
    const constLine = text.split('\n').find((l) => /ALLOW_HEADERS\s*=\s*['"]/.test(l.trim()));
    expect(constLine).toBeDefined();
    for (const h of ['Authorization', 'Content-Type', 'X-Request-Id']) {
      expect(constLine).toContain(h);
    }
  });

  it('front origin derived from FRONTEND_PORT is well-formed', () => {
    const port = envValue(ENV_EXAMPLE, 'FRONTEND_PORT');
    expect(port).toBeDefined();
    const expectedOrigin = `http://localhost:${port}`;
    expect(expectedOrigin).toMatch(/^http:\/\/localhost:\d{2,5}$/);
    const viteText = readFileSync(VITE_CONFIG, 'utf8');
    expect(viteText).toContain(`FRONTEND_PORT`);
  });

  it('vite.config.ts + http.ts do NOT hardcode a different CORS origin', () => {
    const viteText = readFileSync(VITE_CONFIG, 'utf8');
    expect(viteText).not.toMatch(/cors/i);
    expect(viteText).not.toMatch(/access-control-allow-origin/i);
    const httpText = readFileSync(HTTP_TS, 'utf8');
    expect(httpText).toMatch(/VITE_API_BASE_URL/);
    expect(httpText).not.toMatch(/cors/i);
  });

  it('does NOT regress the OPTIONS preflight short-circuit (PR 1 invariant)', () => {
    const text = readFileSync(DEV_SERVER, 'utf8');
    expect(text).toMatch(/method\s*===\s*['"]OPTIONS['"]/);
    expect(text).toMatch(/corsPreflightHeaders/);
  });
});

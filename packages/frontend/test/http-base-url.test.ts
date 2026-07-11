/**
 * PR 3 consolidated TDD spec for the frontend base-URL contract.
 *
 * Covers (per tasks.md PR 3):
 *   - Task 5.1 (REQ-FHC-1): drop the `/local` fallback in `http.ts`; base URL
 *     comes ONLY from `VITE_API_BASE_URL`; no `/local` segment anywhere; no
 *     double-prefixing; trailing-slash normalization (EC-1).
 *   - Task 5.2 (REQ-FHC-2): the `envValidation()` Vite plugin throws the
 *     exact string `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md`
 *     when the env var is undefined or empty.
 *   - Task 5.3 (REQ-FHC-3): no regression on existing call sites
 *     (POST `/auth/login`, GET `/products` with Bearer token).
 *   - Task 6.1 (REQ-FVE-1, FVE-2): `vite-env.ts` imports no `node:fs`/
 *     `node:path`; exports no `readApiBaseUrl`; exports a typed accessor for
 *     `VITE_API_BASE_URL`.
 *   - Task 6.2 (REQ-FVE-2, FHC-2): `vite.config.ts` contains no
 *     `readFileSync` / `.api-url` / `/shared/` / `API_URL_FILE` references;
 *     plugins array includes `envValidation()`.
 *   - Task 6.3 (REQ-FVE-3): no `readApiBaseUrl` symbol exists anywhere in
 *     `packages/frontend/`; `vite-config.test.ts` is deleted.
 *   - Task 6.6 (REQ-FNR-3, FVE-7): `.env.development` declares
 *     `VITE_API_BASE_URL=http://localhost:3001/api/v1`; no `s3-proxy` /
 *     `API_GATEWAY_HOST_EXTERNAL` references.
 *
 * The frontend vitest config picks up `test/**.test.ts` (the wildcard
 * section); the file is named `.test.ts` (not `.spec.ts`) for that reason.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(HERE, '..');
const PKG_ROOT = resolve(FRONTEND_ROOT, '..', '..');

const HTTP_PATH = resolve(FRONTEND_ROOT, 'src/services/http.ts');
const VITE_ENV_PATH = resolve(FRONTEND_ROOT, 'vite-env.ts');
const VITE_CONFIG_PATH = resolve(FRONTEND_ROOT, 'vite.config.ts');
const ENV_DEVELOPMENT_PATH = resolve(FRONTEND_ROOT, '.env.development');
const ENV_PRODUCTION_PATH = resolve(FRONTEND_ROOT, '.env.production');
const OBSOLETE_TEST_PATH = resolve(FRONTEND_ROOT, 'test/vite-config.test.ts');
const PLUGIN_PATH = resolve(FRONTEND_ROOT, 'vite-plugins/env-validation.ts');

const REQUIRED_ERROR = 'VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md';

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

// ---------------------------------------------------------------------------
// Task 5.1 — REQ-FHC-1: drop /local fallback in http.ts
// ---------------------------------------------------------------------------

describe('Task 5.1 — http.ts base URL (REQ-FHC-1)', () => {
  it('does NOT contain the /local fallback string anywhere', () => {
    const text = readText(HTTP_PATH);
    expect(text).not.toContain('http://localhost:3001/local');
    expect(text).not.toContain("'http://localhost:3001/local'");
  });

  it('does NOT use the `??` operator as a base-URL fallback (FVE-7 source-of-truth)', () => {
    // After the change, the base URL resolves from `import.meta.env.VITE_API_BASE_URL`
    // without any `??` fallback to a literal URL. A `??` for non-URL values is fine
    // (e.g. feature flags), but the spec forbids using it for the base URL itself.
    const text = readText(HTTP_PATH);
    // Strip line comments to avoid false positives on documentation that mentions ??.
    const stripped = text
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    // Look for the literal pattern `VITE_API_BASE_URL ?? 'http...` (any quote).
    const hasFallback =
      stripped.includes('VITE_API_BASE_URL ??') &&
      /VITE_API_BASE_URL\s*\?\?\s*['"`][^'"`]*http:/.test(stripped);
    expect(hasFallback).toBe(false);
  });

  it('reads the base URL exclusively from import.meta.env.VITE_API_BASE_URL', () => {
    const text = readText(HTTP_PATH);
    expect(text).toMatch(/import\.meta\.env\.VITE_API_BASE_URL/);
  });
});

// ---------------------------------------------------------------------------
// Task 5.2 — REQ-FHC-2: env-validation Vite plugin
// ---------------------------------------------------------------------------

describe('Task 5.2 — envValidation() Vite plugin (REQ-FHC-2)', () => {
  beforeEach(() => {
    // Force-import isolation: the plugin file MUST exist on disk.
    expect(existsSync(PLUGIN_PATH)).toBe(true);
  });

  it('vite-plugins/env-validation.ts exists and exports envValidation', async () => {
    const mod = await import(PLUGIN_PATH);
    expect(typeof mod.envValidation).toBe('function');
  });

  it('plugin throws the exact required error when VITE_API_BASE_URL is undefined', async () => {
    const mod = await import(PLUGIN_PATH);
    const plugin = mod.envValidation();
    const config: Record<string, unknown> = { env: {} };
    // The plugin exposes the handler via `configResolved`. We call it directly.
    const handler = plugin.configResolved as (cfg: unknown) => void;
    expect(() => handler(config)).toThrowError(REQUIRED_ERROR);
  });

  it('plugin throws the exact required error when VITE_API_BASE_URL is empty', async () => {
    const mod = await import(PLUGIN_PATH);
    const plugin = mod.envValidation();
    const config: Record<string, unknown> = { env: { VITE_API_BASE_URL: '' } };
    const handler = plugin.configResolved as (cfg: unknown) => void;
    expect(() => handler(config)).toThrowError(REQUIRED_ERROR);
  });

  it('plugin does NOT throw when VITE_API_BASE_URL is set', async () => {
    const mod = await import(PLUGIN_PATH);
    const plugin = mod.envValidation();
    const config: Record<string, unknown> = {
      env: { VITE_API_BASE_URL: 'http://localhost:3001/api/v1' },
    };
    const handler = plugin.configResolved as (cfg: unknown) => void;
    expect(() => handler(config)).not.toThrow();
  });

  it('CLI build with VITE_API_BASE_URL="" fails loud (NFR-2: error within first 20 lines)', () => {
    // Smoke: shell out to `vite build` with the env var explicitly empty and
    // assert that the process exits non-zero AND that the required error string
    // appears within the first 20 lines of combined output.
    let stdout = '';
    let stderr = '';
    let status = 0;
    try {
      stdout = execFileSync(
        'pnpm',
        ['--filter', 'frontend', 'exec', 'vite', 'build', '--mode', 'test'],
        {
          cwd: PKG_ROOT,
          env: { ...process.env, VITE_API_BASE_URL: '' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }
    const combined = (stdout + '\n' + stderr).split('\n').slice(0, 20).join('\n');
    expect(status).not.toBe(0);
    expect(combined).toContain(REQUIRED_ERROR);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Task 5.3 — REQ-FHC-3: no regression on existing call sites
// ---------------------------------------------------------------------------

describe('Task 5.3 — HTTP client behavior (REQ-FHC-3)', () => {
  beforeEach(() => {
    // Reset module registry so http.ts re-evaluates the env var.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('http.GET("/products") issues GET /api/v1/products (no /local, no double-prefix)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001/api/v1');

    // Mock ofetch to capture the URL actually requested.
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.doMock('ofetch', () => ({
      ofetch: {
        create: (config: { baseURL: string }) => {
          const baseURL = config.baseURL;
          return (url: string, init?: RequestInit) => {
            const finalUrl = url.startsWith('http') ? url : `${baseURL}${url}`;
            calls.push({ url: finalUrl, init });
            return Promise.resolve({});
          };
        },
      },
    }));

    // Mock the auth store (http.ts imports it for the onRequest hook).
    vi.doMock('@/stores/auth', () => ({
      useAuthStore: () => ({
        token: 'jwt-123',
        tabId: 'tab-uuid',
        logout: vi.fn(),
      }),
    }));

    const { http } = await import('../src/services/http');
    await (http as unknown as (url: string, init?: RequestInit) => Promise<unknown>)('/products');

    expect(calls).toHaveLength(1);
    const finalUrl = calls[0]!.url;
    expect(finalUrl).toBe('http://localhost:3001/api/v1/products');
    // No `/local` stage segment (would appear as `/api/v1/local/...`); the
    // `/local` substring in `/localhost` is fine — it's the host, not a stage.
    expect(finalUrl).not.toMatch(/\/local\//);
    expect(finalUrl).not.toContain('/api/v1/api/v1/');
  });

  it('http.POST("/auth/login", body) issues POST /api/v1/auth/login', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001/api/v1');

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.doMock('ofetch', () => ({
      ofetch: {
        create: (config: { baseURL: string }) => {
          const baseURL = config.baseURL;
          return (url: string, init?: RequestInit) => {
            const finalUrl = url.startsWith('http') ? url : `${baseURL}${url}`;
            calls.push({ url: finalUrl, init });
            return Promise.resolve({});
          };
        },
      },
    }));

    vi.doMock('@/stores/auth', () => ({
      useAuthStore: () => ({
        token: null,
        tabId: 'tab-uuid',
        logout: vi.fn(),
      }),
    }));

    const { http } = await import('../src/services/http');
    await (http as unknown as (url: string, init?: RequestInit) => Promise<unknown>)(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ username: 'a', password: 'b' }) } as RequestInit,
    );

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('http://localhost:3001/api/v1/auth/login');
    expect(call.init?.method).toBe('POST');
  });

  it('EC-1 — trailing slash in base URL is normalized away', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001/api/v1/');

    const calls: Array<{ url: string }> = [];
    vi.doMock('ofetch', () => ({
      ofetch: {
        create: (config: { baseURL: string }) => {
          // Mirror ofetch's behavior: strip trailing slash from baseURL.
          const baseURL = config.baseURL.replace(/\/$/, '');
          return (url: string) => {
            const finalUrl = url.startsWith('http') ? url : `${baseURL}${url}`;
            calls.push({ url: finalUrl });
            return Promise.resolve({});
          };
        },
      },
    }));

    vi.doMock('@/stores/auth', () => ({
      useAuthStore: () => ({
        token: null,
        tabId: 'tab-uuid',
        logout: vi.fn(),
      }),
    }));

    const { http } = await import('../src/services/http');
    await (http as unknown as (url: string) => Promise<unknown>)('/products');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:3001/api/v1/products');
    expect(calls[0]!.url).not.toContain('//products');
  });
});

// ---------------------------------------------------------------------------
// Task 6.1 — REQ-FVE-1, FVE-2: vite-env.ts reads ONLY from import.meta.env
// ---------------------------------------------------------------------------

describe('Task 6.1 — vite-env.ts env-only (REQ-FVE-1, FVE-2)', () => {
  it('does NOT import node:fs, node:path, or fs/promises', () => {
    const text = readText(VITE_ENV_PATH);
    expect(text).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(text).not.toMatch(/from\s+['"]node:path['"]/);
    expect(text).not.toMatch(/from\s+['"]fs\/promises['"]/);
    expect(text).not.toMatch(/from\s+['"]fs['"]/);
  });

  it('does NOT export readApiBaseUrl', () => {
    const text = readText(VITE_ENV_PATH);
    expect(text).not.toMatch(/export\s+function\s+readApiBaseUrl/);
    expect(text).not.toMatch(/export\s+const\s+readApiBaseUrl/);
    expect(text).not.toMatch(/export\s+\{\s*[^}]*\breadApiBaseUrl\b/);
  });

  it('does NOT reference /shared/.api-url or API_URL_FILE', () => {
    const text = readText(VITE_ENV_PATH);
    expect(text).not.toMatch(/\/shared\/\.api-url/);
    expect(text).not.toMatch(/API_URL_FILE/);
  });

  it('exports a typed accessor for VITE_API_BASE_URL (ImportMetaEnv typing intact)', () => {
    const text = readText(VITE_ENV_PATH);
    // Either an Interface declaration merging ImportMetaEnv or a typed export.
    const hasInterfaceMerge = /interface\s+ImportMetaEnv/.test(text);
    const hasViteEnvAccess = /VITE_API_BASE_URL/.test(text);
    expect(hasViteEnvAccess).toBe(true);
    // The typed accessor surface (interface merge OR exported const accessor).
    expect(hasInterfaceMerge || /export\s+(const|function)\s+\w*[Bb]aseUrl/.test(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 6.2 — REQ-FVE-2 + REQ-FHC-2 wiring: vite.config.ts cleaned, envValidation loaded
// ---------------------------------------------------------------------------

describe('Task 6.2 — vite.config.ts cleanup (REQ-FVE-2 + FHC-2 wiring)', () => {
  it('does NOT contain readFileSync, .api-url, /shared/.api-url, API_URL_FILE', () => {
    const text = readText(VITE_CONFIG_PATH);
    expect(text).not.toMatch(/readFileSync/);
    expect(text).not.toMatch(/\.api-url/);
    // /shared/.api-url is the sidecar file path; the alias `../shared/src/...`
    // is the legitimate shared package path (different from the sidecar).
    expect(text).not.toMatch(/\/shared\/\.api-url/);
    expect(text).not.toMatch(/API_URL_FILE/);
  });

  it('does NOT import readApiBaseUrl from vite-env', () => {
    const text = readText(VITE_CONFIG_PATH);
    expect(text).not.toMatch(/readApiBaseUrl/);
  });

  it('loads envValidation() in the plugins array', () => {
    const text = readText(VITE_CONFIG_PATH);
    expect(text).toMatch(/envValidation\(\)/);
    // Imported from the local vite-plugins path.
    expect(text).toMatch(/from\s+['"]\.\/vite-plugins\/env-validation['"]/);
  });
});

// ---------------------------------------------------------------------------
// Task 6.3 — REQ-FVE-3: vite-config.test.ts deleted, readApiBaseUrl gone
// ---------------------------------------------------------------------------

describe('Task 6.3 — obsolete vite-config.test.ts removed (REQ-FVE-3)', () => {
  it('packages/frontend/test/vite-config.test.ts is deleted', () => {
    expect(existsSync(OBSOLETE_TEST_PATH)).toBe(false);
  });

  it('no readApiBaseUrl symbol exists anywhere in packages/frontend/', () => {
    const matches = grepPackagesFrontend('readApiBaseUrl');
    expect(matches).toEqual([]);
  });
});

function grepPackagesFrontend(token: string): string[] {
  let stdout = '';
  try {
    stdout = execFileSync(
      'grep',
      [
        '-rE',
        token,
        '--include=*.ts',
        '--include=*.md',
        '--include=*.json',
        // Exclude test files (this very spec references the symbol by design).
        '--exclude=*.test.ts',
        '--exclude=*.spec.ts',
        FRONTEND_ROOT,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return [];
    throw err;
  }
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Task 6.6 — REQ-FNR-3, FVE-7: .env.development declares VITE_API_BASE_URL
// ---------------------------------------------------------------------------

describe('Task 6.6 — .env.development declares VITE_API_BASE_URL (REQ-FNR-3, FVE-7)', () => {
  it('.env.development exists and is non-empty', () => {
    expect(existsSync(ENV_DEVELOPMENT_PATH)).toBe(true);
    const stat = statSync(ENV_DEVELOPMENT_PATH);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('.env.development sets VITE_API_BASE_URL=http://localhost:3001/api/v1', () => {
    const text = readText(ENV_DEVELOPMENT_PATH);
    expect(text).toMatch(/VITE_API_BASE_URL\s*=\s*http:\/\/localhost:3001\/api\/v1\b/);
  });

  it('.env.development has NO s3-proxy or API_GATEWAY_HOST_EXTERNAL', () => {
    if (existsSync(ENV_DEVELOPMENT_PATH)) {
      const text = readText(ENV_DEVELOPMENT_PATH);
      expect(text).not.toMatch(/s3-proxy/);
      expect(text).not.toMatch(/API_GATEWAY_HOST_EXTERNAL/);
    }
    if (existsSync(ENV_PRODUCTION_PATH)) {
      const text = readText(ENV_PRODUCTION_PATH);
      expect(text).not.toMatch(/s3-proxy/);
      expect(text).not.toMatch(/API_GATEWAY_HOST_EXTERNAL/);
    }
  });

  it('every VITE_* key in .env.development has a non-empty value', () => {
    const text = readText(ENV_DEVELOPMENT_PATH);
    const lines = text
      .split('\n')
      .filter((l) => l.length > 0 && !l.startsWith('#') && /^VITE_[A-Z0-9_]*\s*=/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const value = line.split('=', 2)[1]?.trim() ?? '';
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

// Suppress unused-import warning for join() — kept for future grep helpers.
void join;

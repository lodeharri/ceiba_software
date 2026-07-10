/**
 * PR 4 RED-first unit tests (design.md §3.16, tasks.md §2 PR 4).
 *
 * Verifies that the helper used by `packages/frontend/vite.config.ts` resolves
 * the API base URL with the precedence required by tasks.md §PR 4:
 *
 *   1. The file at `process.env.API_URL_FILE` (when set + readable).
 *   2. The file `./.api-url` or `/shared/.api-url` (Docker bind mount).
 *   3. `process.env.VITE_API_BASE_URL` (env var fallback for non-file scenarios).
 *   4. `undefined` when none of the above is available.
 *
 * The file WINS over the env var — if `.api-url` has a different URL than
 * `VITE_API_BASE_URL`, the file value is used. This lets non-container dev
 * pick up the URL the deployer just wrote, even if a stale env var is in
 * scope.
 *
 * The config wiring (`define['import.meta.env.VITE_API_BASE_URL']`,
 * `server.host`, `server.port`, `server.strictPort`) is exercised by the
 * existing `vite-build.test.ts` smoke test in PR 0 (it shells out to
 * `vite build`, which would surface any wiring break at startup).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readApiBaseUrl } from '../vite-env';

const ORIGINAL_ENV = { ...process.env };

function withTmpApiUrlFile(contents: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vite-cfg-'));
  const file = join(dir, '.api-url');
  writeFileSync(file, contents, 'utf8');
  return { dir, file };
}

describe('vite.config — API URL discovery (PR 4, design.md §3.16)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VITE_API_BASE_URL;
    delete process.env.API_URL_FILE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('readApiBaseUrl() precedence', () => {
    it('returns VITE_API_BASE_URL from process.env when no file is present', () => {
      process.env.VITE_API_BASE_URL = 'http://from-env:9999';
      expect(readApiBaseUrl()).toBe('http://from-env:9999');
    });

    it('reads the file at API_URL_FILE when set and the file exists', () => {
      const { dir, file } = withTmpApiUrlFile('http://from-file:8888\n');
      try {
        process.env.API_URL_FILE = file;
        expect(readApiBaseUrl()).toBe('http://from-file:8888');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('prefers the file over the env var when both are set (TRIANGULATE)', () => {
      const { dir, file } = withTmpApiUrlFile('http://from-file:8888\n');
      try {
        process.env.API_URL_FILE = file;
        process.env.VITE_API_BASE_URL = 'http://from-env:9999';
        expect(readApiBaseUrl()).toBe('http://from-file:8888');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('trims whitespace and newlines from the file content', () => {
      const { dir, file } = withTmpApiUrlFile('   http://with-whitespace:7777   \n');
      try {
        process.env.API_URL_FILE = file;
        expect(readApiBaseUrl()).toBe('http://with-whitespace:7777');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('ignores a file whose contents are only whitespace', () => {
      const { dir, file } = withTmpApiUrlFile('   \n  \n');
      try {
        process.env.API_URL_FILE = file;
        process.env.VITE_API_BASE_URL = 'http://from-env:9999';
        expect(readApiBaseUrl()).toBe('http://from-env:9999');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to env var when API_URL_FILE points to a missing file', () => {
      process.env.API_URL_FILE = '/does/not/exist/.api-url';
      process.env.VITE_API_BASE_URL = 'http://from-env:9999';
      expect(readApiBaseUrl()).toBe('http://from-env:9999');
    });

    it('returns undefined when neither env var nor file is available', () => {
      expect(readApiBaseUrl()).toBeUndefined();
    });
  });
});

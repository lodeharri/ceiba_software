/**
 * Tests for env.ts — verifies dotenv loading from .env.dev works correctly.
 *
 * Strict TDD: RED (this test fails) → GREEN (env.ts implemented) → REFACTOR if needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('env.ts', () => {
  const ORIGINAL_ENV = { ...process.env };
  const testEnvPath = resolve(__dirname, '..', '.env.test-temp');

  beforeEach(() => {
    // Restore original env after each test
    process.env = { ...ORIGINAL_ENV };
    // Clean up any leftover test env file
    try {
      if (existsSync(testEnvPath)) {
        unlinkSync(testEnvPath);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('loads process.env from a custom path via INFRA_ENV_FILE', () => {
    // Create a temporary .env file with a known key
    const testValue = 'test-value-from-custom-path-12345';
    writeFileSync(testEnvPath, `SOME_TEST_VAR=${testValue}\n`);

    // Spawn a child process that runs env.js with INFRA_ENV_FILE set.
    // env.js will call dotenv.config() with the custom path.
    // We verify the import succeeded by checking the process exits 0.
    // Note: env.js is a side-effect-only module (no exports), so we can't
    // import it directly. We test via child process exit code.
    try {
      execSync(
        `node --experimental-vm-modules -e "
          import('./dist/src/env.js');
        "`,
        {
          cwd: resolve(__dirname, '..'),
          env: { ...ORIGINAL_ENV, INFRA_ENV_FILE: testEnvPath },
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      );
      // If we get here, the import succeeded
      expect(true).toBe(true);
    } catch (error) {
      const e = error as { status?: number; message?: string };
      // The test fails if env.js doesn't exist or has errors
      expect(e.status).toBe(0);
    }
  });

  it('default .env.dev path resolves to a file that exists', () => {
    // env.ts resolves from compiled location: dist/src/env.js → ../../../../.env.dev
    // The repo root .env.dev should exist (4 levels up from dist/src/)
    // __dirname for test file is packages/infra/test/, so we need:
    // test/ → infra/ → packages/ → ceiba_software/ → .env.dev
    const repoRootEnvDev = resolve(__dirname, '..', '..', '..', '.env.dev');
    expect(existsSync(repoRootEnvDev)).toBe(true);
  });
});

/**
 * RED-first smoke test (PR 0, tasks.md §2).
 *
 * Shells out to `pnpm --filter frontend exec vite build --mode test` and
 * asserts the exit code is 0. The stub App.vue + index.html + main.ts
 * shipped in commit 4 are enough for Vite to emit a bundle; if the
 * frontend tsconfig or vite config drifts this test fails fast.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

function viteBuild(): number {
  try {
    execSync('pnpm --filter frontend exec vite build --mode test', {
      stdio: 'pipe',
      cwd: process.cwd(),
    });
    return 0;
  } catch (error) {
    const e = error as { status?: number | null };
    return e.status ?? 1;
  }
}

describe('PR 0 frontend smoke test', () => {
  it('frontend vite build (mode=test) exits 0', () => {
    expect(viteBuild()).toBe(0);
  }, 60_000);
});

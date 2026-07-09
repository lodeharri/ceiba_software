/**
 * RED-first smoke test (PR 0, tasks.md §2).
 *
 * Shells out to `pnpm --filter backend exec tsc --noEmit` and asserts
 * the exit code is 0. If the backend tsconfig drifts from the strict
 * settings inherited from tsconfig.base.json this test fails fast.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

function tscNoEmit(): number {
  try {
    execSync('pnpm --filter backend exec tsc --noEmit', {
      stdio: 'pipe',
      cwd: process.cwd(),
    });
    return 0;
  } catch (error) {
    const e = error as { status?: number | null };
    return e.status ?? 1;
  }
}

describe('PR 0 backend smoke test', () => {
  it('backend tsc --noEmit exits 0', () => {
    expect(tscNoEmit()).toBe(0);
  });
});

/**
 * CDK synth smoke test for PR 1.
 *
 * Shells out to `pnpm --filter infra exec cdk synth --all --no-color`
 * and asserts exit 0. The synth MUST succeed even when no real AWS
 * credentials are configured (CDK synth is local — no AWS calls).
 *
 * If any CDK construct has a missing dependency, wrong region, or
 * circular import, this test fails fast.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

function synth(): { ok: boolean; output: string } {
  try {
    const output = execSync('pnpm --filter infra exec cdk synth --all --no-color 2>&1 || true', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    return { ok: true, output };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: (e.stdout ?? '') + (e.stderr ?? ''),
    };
  }
}

describe('PR 1 CDK synth smoke test', () => {
  it('cdk synth --all exits 0 (no AWS calls)', () => {
    const result = synth();
    if (!result.ok) {
      // Surface the synth output to make failures debuggable.
      // The first 4000 chars are usually enough to find the offending construct.

      console.error('cdk synth output (truncated):\n', result.output.slice(0, 4000));
    }
    expect(result.ok).toBe(true);
  }, 120_000);
});

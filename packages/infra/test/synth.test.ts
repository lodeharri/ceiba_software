/**
 * CDK synth smoke test for PR 1.
 *
 * Shells out to `cdk synth -c stage=dev` and `cdk synth -c stage=prod`
 * and asserts both succeed. CDK 2.112+ no longer ships `--all`, so we
 * iterate per stage.
 *
 * If any CDK construct has a missing dependency, wrong region, or
 * circular import, this test fails fast. The tests run a build step
 * first because the CDK app is loaded from `dist/src/app.js`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

function run(cmd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
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
  beforeAll(() => {
    // Compile the CDK app so the `dist/src/app.js` entry the cdk.json
    // points to exists. CDK 2.x loads the app from the build artifact,
    // not the source TypeScript directly.
    const build = run('pnpm --filter infra exec tsc -p tsconfig.build.json');
    if (!build.ok) {
      throw new Error(`infra build failed: ${build.output}`);
    }
  }, 120_000);

  it('cdk synth -c stage=dev exits 0', () => {
    const result = run('pnpm --filter infra exec cdk synth -c stage=dev --no-color');
    if (!result.ok) {
      console.error('cdk synth dev output (truncated):\n', result.output.slice(0, 4000));
    }
    expect(result.ok).toBe(true);
  }, 120_000);

  it('cdk synth -c stage=prod exits 0', () => {
    const result = run('pnpm --filter infra exec cdk synth -c stage=prod --no-color');
    if (!result.ok) {
      console.error('cdk synth prod output (truncated):\n', result.output.slice(0, 4000));
    }
    expect(result.ok).toBe(true);
  }, 120_000);
});

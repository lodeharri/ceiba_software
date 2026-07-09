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
 *
 * The `new Vpc()` we use in DatabaseStack triggers an availability-zone
 * lookup; we seed `cdk.context.json` with a placeholder AZ list so the
 * synth completes without AWS credentials.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const INFRA_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTEXT_FILE = path.join(INFRA_ROOT, 'cdk.context.json');

function run(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      cwd,
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
    const build = run('pnpm exec tsc -p tsconfig.build.json', INFRA_ROOT);
    if (!build.ok) {
      throw new Error(`infra build failed: ${build.output}`);
    }

    // Seed the context file with a placeholder availability-zone list.
    // CDK re-creates the file if missing, but the synth fails on first
    // AZ lookup without it. PR 2a+ may replace `new Vpc()` with
    // `Vpc.fromLookup` against a real account; this context seed becomes
    // irrelevant then.
    if (!existsSync(path.dirname(CONTEXT_FILE))) {
      mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    }
    const context = {
      'availability-zones:account=000000000000:region=us-east-1': ['us-east-1a', 'us-east-1b'],
    };
    writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2));
  }, 120_000);

  it('cdk synth -c stage=dev exits 0', () => {
    const result = run('pnpm exec cdk synth -c stage=dev --no-color', INFRA_ROOT);
    if (!result.ok) {
      console.error('cdk synth dev output (truncated):\n', result.output.slice(0, 4000));
    }
    expect(result.ok).toBe(true);
  }, 120_000);

  it('cdk synth -c stage=prod exits 0', () => {
    const result = run('pnpm exec cdk synth -c stage=prod --no-color', INFRA_ROOT);
    if (!result.ok) {
      console.error('cdk synth prod output (truncated):\n', result.output.slice(0, 4000));
    }
    expect(result.ok).toBe(true);
  }, 120_000);
});

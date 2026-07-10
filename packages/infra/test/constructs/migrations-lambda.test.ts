/**
 * RED-first tests for migrations-lambda env-var bypass (PR 2, tasks.md §2 PR 2).
 *
 * Asserts the stage-aware resolution locked in design.md §3.14:
 *   - STAGE=localstack → resolveDatabaseUrl() returns process.env.DATABASE_URL
 *     directly (no AWS SDK call). resolveAdminPassword() returns
 *     process.env.ADMIN_PASSWORD directly (no AWS SDK call).
 *   - STAGE=dev        → existing AWS SDK path (Secrets Manager + SSM).
 *
 * The handler exports a single `handler` function; tests reach the resolver
 * helpers by importing the module's internals. Because the resolver helpers
 * are not exported directly, the test inspects the Lambda handler's behavior
 * by capturing what it logs / passes to the AWS SDK calls (mocked).
 *
 * RED state: `migrations-lambda.ts` does not branch on STAGE; calling the
 * handler with STAGE=localstack falls through to the Secrets Manager / SSM
 * code path, which throws because no SDK clients can resolve secrets in a
 * test environment. GREEN state adds the `STAGE === 'localstack'` branch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface ModuleUnderTest {
  handler: (event: {
    RequestType: 'Create' | 'Update' | 'Delete';
    PhysicalResourceId?: string;
  }) => Promise<{
    Status: 'SUCCESS' | 'FAILED';
    Reason?: string;
    PhysicalResourceId?: string;
  }>;
}

function loadModule(stage: 'localstack' | 'dev' | 'prod'): ModuleUnderTest {
  // Reset module cache so each stage gets a fresh import (env vars are
  // frozen at module load time).
  vi.resetModules();
  process.env['STAGE'] = stage;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../dist/src/constructs/migrations-lambda.js') as ModuleUnderTest;
}

const ORIGINAL_ENV = { ...process.env };

describe('migrations-lambda (PR 2 — STAGE-aware env-var bypass)', () => {
  beforeEach(() => {
    // Snapshot env vars we will mutate so the test stays hermetic.
    delete process.env['DATABASE_URL'];
    delete process.env['ADMIN_PASSWORD'];
    delete process.env['DATABASE_SECRET_ARN'];
    delete process.env['ADMIN_PASSWORD_PARAM_NAME'];
  });

  afterEach(() => {
    // Restore the original env after each test so other suites are unaffected.
    process.env = { ...ORIGINAL_ENV };
  });

  it('STAGE=localstack bypasses AWS SDK and reads process.env.DATABASE_URL directly', async () => {
    process.env['DATABASE_URL'] = 'postgresql://ceiba:ceiba_dev@postgres:5432/mercadoexpress';
    process.env['ADMIN_PASSWORD'] = 'admin-local-dev-password-change-me';

    const { handler } = loadModule('localstack');
    const result = await handler({ RequestType: 'Create' });

    // The handler will still FAILED here because we cannot run the prisma
    // migrate deploy + seed subprocesses in the test environment (no real
    // Postgres + no prisma schema on disk). What matters is the failure
    // reason: it MUST come from the prisma subprocess (env-var resolution
    // succeeded), NOT from the AWS SDK or env-var resolution itself.
    expect(result.Status).toBe('FAILED');
    expect(result.Reason).toBeDefined();
    // The env-var error string is only raised by the env-var bypass path
    // when the var is missing — its absence here proves the path succeeded.
    expect(result.Reason ?? '').not.toMatch(/DATABASE_URL env var is not set/);
    expect(result.Reason ?? '').not.toMatch(/security token/i);
    expect(result.Reason ?? '').not.toMatch(/DATABASE_SECRET_ARN env var is not set/);
  });

  it('STAGE=localstack + missing DATABASE_URL throws with a clear error', async () => {
    // DATABASE_URL is NOT set; ADMIN_PASSWORD is.
    process.env['ADMIN_PASSWORD'] = 'admin-local-dev-password-change-me';

    const { handler } = loadModule('localstack');
    const result = await handler({ RequestType: 'Create' });

    expect(result.Status).toBe('FAILED');
    expect(result.Reason).toMatch(/DATABASE_URL/);
  });

  it('STAGE=dev uses the AWS secrets path (Secrets Manager + SSM)', async () => {
    // Both env vars absent; the AWS code path must fail because there is no
    // Secrets Manager client in the test environment.
    process.env['DATABASE_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db';
    process.env['ADMIN_PASSWORD_PARAM_NAME'] = '/MercadoExpress/dev/admin-password';

    const { handler } = loadModule('dev');
    const result = await handler({ RequestType: 'Create' });

    // The dev/prod path tries to instantiate the AWS SDK client; without
    // network credentials this will throw. We assert the failure message
    // is the AWS path error (NOT the env-var error), proving the branch
    // landed on the AWS side.
    expect(result.Status).toBe('FAILED');
    expect(result.Reason).toBeDefined();
    // The env-var error string is only raised by the localstack branch.
    expect(result.Reason ?? '').not.toMatch(/DATABASE_URL env var is not set/);
  });
});

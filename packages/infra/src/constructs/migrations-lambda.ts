/**
 * Migrations Lambda entry (PR 2a BLOCKER C2 closeout + PR 2).
 *
 * On stack create/update, this Lambda runs in one invocation:
 *   1. DATABASE_URL and ADMIN_PASSWORD are pre-resolved at deploy time
 *      via CDK SecretValue / Fn::Join intrinsics (no runtime SDK calls).
 *   2. `npx prisma migrate deploy` against DATABASE_URL.
 *   3. `npx tsx prisma/seed.ts` against DATABASE_URL (idempotent upserts).
 *   4. Return { Status: 'SUCCESS' | 'FAILED', Data, Reason }.
 *
 * On Delete: no-op (migrations are additive-only, DB outlives the stack).
 *
 * PR 2 changes: no longer calls GetSecretValue or GetParameter at runtime.
 * DATABASE_URL and ADMIN_PASSWORD are passed as pre-resolved env vars.
 * The localstack stage bypass reads DATABASE_URL directly from process.env.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve THIS file's directory in either CJS (production Lambda after
// esbuild bundling) or ESM (test run via Node's require(esm)). CJS strips
// `import.meta.url` to an empty object, so we fall back to the standard
// `__dirname` shim which is always available in CJS.
const THIS_DIR: string =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
// Resolve the Prisma schema + seed paths.
// In the Lambda runtime, __dirname = /var/task (esbuild output root). The
// bundling.commandHooks.beforeBundling installs prisma + @prisma/client into
// /var/task/node_modules/, and afterBundling copies schema.prisma and seed.ts
// into /var/task/backend/prisma/.
const PRISMA_SCHEMA_PATH = path.resolve(THIS_DIR, 'backend/prisma/schema.prisma');
const PRISMA_SEED_PATH = path.resolve(THIS_DIR, 'backend/prisma/seed.ts');

// DEFINITIVE FIX — invoke the bundled prisma CLI directly instead of `npx`.
// The Lambda is in PRIVATE_ISOLATED subnets; npx would try to reach
// registry.npmjs.org and fail. Instead, node_modules/prisma/build/index.js
// is installed at synth time by beforeBundling in migrations.ts.
// We invoke it with `node` so shebang/pATH issues don't apply.
const PRISMA_CLI = path.resolve(THIS_DIR, 'node_modules/prisma/build/index.js');
const TSX_CLI = path.resolve(THIS_DIR, 'node_modules/tsx/dist/cli.mjs');

interface CloudFormationResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId?: string;
  Data?: Record<string, unknown>;
  NoEcho?: boolean;
}

interface CloudFormationCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
  [key: string]: unknown;
}

function respond(event: CloudFormationCustomResourceEvent, response: CloudFormationResponse): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: event.RequestType, response }));
}

function runCommand(
  cmd: string,
  args: string[],
  env: Record<string, string>,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationResponse> => {
  if (event.RequestType === 'Delete') {
    respond(event, {
      Status: 'SUCCESS',
      PhysicalResourceId: event.PhysicalResourceId ?? 'migrate-and-seed',
    });
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: event.PhysicalResourceId ?? 'migrate-and-seed',
    };
  }

  // DATABASE_URL and ADMIN_PASSWORD are pre-resolved at CDK deploy time via
  // Fn::Join / SecretValue intrinsics. No runtime SDK calls needed.
  const databaseUrl = process.env['DATABASE_URL'];
  const adminPassword = process.env['ADMIN_PASSWORD'];

  if (!databaseUrl) {
    const reason = 'DATABASE_URL env var is not set';
    respond(event, { Status: 'FAILED', Reason: reason });
    return { Status: 'FAILED', Reason: reason };
  }
  if (!adminPassword) {
    const reason = 'ADMIN_PASSWORD env var is not set';
    respond(event, { Status: 'FAILED', Reason: reason });
    return { Status: 'FAILED', Reason: reason };
  }

  const env: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    ADMIN_PASSWORD: adminPassword,
  };

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: 'running prisma migrate deploy',
      databaseUrlHost: databaseUrl.split('@').pop(),
    }),
  );

  try {
    const migrate = runCommand(
      process.execPath,
      [PRISMA_CLI, 'migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH],
      env,
    );
    if (!migrate.ok) {
      const reason = `prisma migrate deploy failed: ${migrate.stderr}`;

      console.error(reason);
      respond(event, { Status: 'FAILED', Reason: reason });
      return { Status: 'FAILED', Reason: reason };
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ msg: 'running prisma seed' }));
    const seed = runCommand(process.execPath, [TSX_CLI, PRISMA_SEED_PATH], env);
    if (!seed.ok) {
      const reason = `prisma seed failed: ${seed.stderr}`;

      console.error(reason);
      respond(event, { Status: 'FAILED', Reason: reason });
      return { Status: 'FAILED', Reason: reason };
    }

    respond(event, { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' });
    return { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    console.error(JSON.stringify({ msg: 'migrate-and-seed uncaught error', reason }));
    respond(event, { Status: 'FAILED', Reason: reason });
    return { Status: 'FAILED', Reason: reason };
  }
};

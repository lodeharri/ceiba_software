/**
 * Migrations Lambda entry (PR 2a BLOCKER C2 closeout + PR 2).
 *
 * On stack create/update, this Lambda runs in one invocation:
 *   1. Resolve DATABASE_URL via GetSecretValue against DATABASE_SECRET_ARN.
 *   2. Resolve ADMIN_PASSWORD via GetParameter against ADMIN_PASSWORD_PARAM_NAME.
 *   3. `npx prisma migrate deploy` against DATABASE_URL.
 *   4. `npx tsx prisma/seed.ts` against DATABASE_URL (idempotent upserts).
 *   5. Return { Status: 'SUCCESS' | 'FAILED', Data, Reason }.
 *
 * On Delete: no-op (migrations are additive-only, DB outlives the stack).
 *
 * PR 2 changes (design.md §3.14):
 *   - STAGE=localstack bypasses Secrets Manager / SSM. The Lambda reads
 *     DATABASE_URL and ADMIN_PASSWORD directly from process.env. This is
 *     the only way LocalStack deployments work because the DynamoDB-backed
 *     Secrets Manager / SSM services are local-only and do not survive
 *     across deployer restarts in a predictable way.
 *   - STAGE=dev|prod keep the existing AWS SDK resolution path.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { SSMClient } from '@aws-sdk/client-ssm';
import { GetParameterCommand } from '@aws-sdk/client-ssm';

// Resolve THIS file's directory in either CJS (production Lambda after
// esbuild bundling) or ESM (test run via Node's require(esm)). CJS strips
// `import.meta.url` to an empty object, so we fall back to the standard
// `__dirname` shim which is always available in CJS.
const THIS_DIR: string =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
// Resolve the Prisma schema + seed paths relative to THIS file so the
// subprocess finds them regardless of CWD (test runs from packages/infra,
// production Lambda runs from /var/task after esbuild bundling).
// From packages/infra/src/constructs/ (or dist/src/constructs/), the
// backend prisma dir is 4 levels up + packages/backend/prisma/.
const PRISMA_SCHEMA_PATH = path.resolve(THIS_DIR, '../../../../backend/prisma/schema.prisma');
const PRISMA_SEED_PATH = path.resolve(THIS_DIR, '../../../../backend/prisma/seed.ts');

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

function resolveLocalEnvValue(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`${name} env var is not set`);
  }
  return value;
}

async function resolveDatabaseUrl(): Promise<string> {
  // PR 2: localstack stage bypasses Secrets Manager. The deployer (or
  // docker compose) populates DATABASE_URL directly in the Lambda env.
  if (process.env['STAGE'] === 'localstack') {
    return resolveLocalEnvValue('DATABASE_URL');
  }

  const secretArn = process.env['DATABASE_SECRET_ARN'];
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN env var is not set');
  }

  // The AWS SDK v3 is available in the Lambda runtime.

  const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
  const Client = SecretsManagerClient as new (opts: object) => SecretsManagerClient;
  const client = new Client({});
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await client.send(command);
  const secretValue = response.SecretString;
  if (!secretValue) {
    throw new Error(`Empty secret value for ARN: ${secretArn}`);
  }
  // The secret contains JSON: { "username": "...", "password": "...", "host": "...", "port": 5432, "dbname": "..." }
  let parsed: { username: string; password: string; host: string; port: number; dbname: string };
  try {
    parsed = JSON.parse(secretValue) as {
      username: string;
      password: string;
      host: string;
      port: number;
      dbname: string;
    };
  } catch {
    throw new Error(`DATABASE_SECRET_ARN did not contain valid JSON: ${secretArn}`);
  }
  const { username, password, host, port, dbname } = parsed;
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${username}:${encodedPassword}@${host}:${port}/${dbname}`;
}

async function resolveAdminPassword(): Promise<string> {
  // PR 2: localstack stage bypasses SSM. The deployer populates
  // ADMIN_PASSWORD directly in the Lambda env.
  if (process.env['STAGE'] === 'localstack') {
    return resolveLocalEnvValue('ADMIN_PASSWORD');
  }

  const paramName = process.env['ADMIN_PASSWORD_PARAM_NAME'];
  if (!paramName) {
    throw new Error('ADMIN_PASSWORD_PARAM_NAME env var is not set');
  }

  const { SSMClient } = await import('@aws-sdk/client-ssm');
  const Client = SSMClient as new (opts: object) => SSMClient;
  const client = new Client({});
  const command = new GetParameterCommand({ Name: paramName, WithDecryption: true });
  const response = await client.send(command);
  const value = response.Parameter?.Value;
  if (!value) {
    throw new Error(`Empty admin password value for SSM parameter: ${paramName}`);
  }
  return value;
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

  // Create and Update: run migrations + seed.
  try {
    const [databaseUrl, adminPassword] = await Promise.all([
      resolveDatabaseUrl(),
      resolveAdminPassword(),
    ]);
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

    const migrate = runCommand(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH],
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
    const seed = runCommand('npx', ['tsx', PRISMA_SEED_PATH], env);
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

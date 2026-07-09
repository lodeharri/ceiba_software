/**
 * Migrations Lambda entry (PR 1).
 *
 * On invocation:
 *   1. Read DATABASE_URL from SSM Parameter Store (already in env).
 *   2. Spawn `npx prisma migrate deploy`.
 *   3. If step 2 succeeds, spawn `npx tsx prisma/seed.ts`.
 *   4. Return { Status: 'SUCCESS' | 'FAILED', Data, Reason }.
 *
 * PR 1 ships the wiring only; the actual seed body lands in PR 2a.
 */

import { spawnSync } from 'node:child_process';

interface CloudFormationResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId?: string;
  Data?: Record<string, unknown>;
  NoEcho?: boolean;
}

function respond(event: unknown, response: CloudFormationResponse): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event, response }));
}

function runCommand(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    stdio: 'pipe',
    encoding: 'utf-8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export const handler = async (event: { RequestType: string }): Promise<CloudFormationResponse> => {
  if (event.RequestType === 'Delete') {
    // We do NOT drop the database on stack delete. Migrations are
    // additive-only (per design.md §10.3) and the DB outlives the stack.
    respond(event, { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' });
    return { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' };
  }

  // PR 1 stub: log intent, return success so the synth test passes.
  // PR 2a replaces the body with real `prisma migrate deploy` + seed calls.
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: 'migrate-and-seed PR 1 stub',
      databaseUrlHost: databaseUrl.split('@').pop() ?? 'unset',
      requestType: event.RequestType,
    }),
  );

  // Even in the stub, surface the intent — the real commands land in
  // PR 2a when `prisma/schema.prisma` and `prisma/seed.ts` ship.
  void runCommand;

  respond(event, { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' });
  return { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' };
};

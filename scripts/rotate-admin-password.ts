#!/usr/bin/env npx tsx
/**
 * Rotate the admin user's password (KL-01).
 *
 * Reads the admin username from $ADMIN_USERNAME or argv[2], generates a fresh
 * cryptographically-random password, hashes it with bcrypt (cost 10, matching
 * prisma/seed.ts BCRYPT_COST default), and persists the new password_hash via
 * Prisma. The cleartext password is printed to stdout exactly once so the
 * operator can store it in a secrets manager — it is NEVER logged.
 *
 * Usage:
 *   cd packages/backend && pnpm exec tsx ../../scripts/rotate-admin-password.ts
 *   ADMIN_USERNAME=admin pnpm --filter backend exec tsx ../../scripts/rotate-admin-password.ts
 *   cd packages/backend && pnpm exec tsx ../../scripts/rotate-admin-password.ts admin
 *
 * Required env:
 *   DATABASE_URL                Postgres connection string (Prisma reads it)
 *   ADMIN_USERNAME              (optional) admin username — falls back to argv[2]
 *   BCRYPT_COST                 (optional) bcrypt cost factor — defaults to 10
 *
 * Exit codes:
 *   0  password rotated, new cleartext printed to stdout as JSON
 *   1  failure (missing env, user not found, DB error)
 */

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Cross-package resolution: bcrypt and @prisma/client live in packages/backend's
// node_modules. We anchor createRequire() at the backend package so Node's
// module resolution walks from there instead of from scripts/ (which has no
// direct dependencies). This avoids adding new top-level deps.
const here = pathToFileURL(import.meta.url);
const backendRequire = createRequire(new URL('../packages/backend/package.json', here).href);

interface BcryptModule {
  hash(data: string, saltOrRounds: number | string): Promise<string>;
}

interface PrismaClientCtor {
  new (): {
    user: {
      findUnique(args: {
        where: { username: string };
      }): Promise<{ id: string; username: string } | null>;
      update(args: {
        where: { username: string };
        data: { passwordHash: string };
      }): Promise<{ id: string; username: string }>;
    };
    $disconnect(): Promise<void>;
  };
}

const bcryptMod = backendRequire('bcrypt') as BcryptModule;
const { PrismaClient } = backendRequire('@prisma/client') as { PrismaClient: PrismaClientCtor };

const DEFAULT_BCRYPT_COST = 10;
const PASSWORD_BYTES = 24; // 24 random bytes → 32 base64url chars (192 bits of entropy)

interface RotateResult {
  readonly username: string;
  readonly password: string;
  readonly rotatedAt: string;
  readonly bcryptCost: number;
}

function resolveUsername(): string | undefined {
  const fromArg = process.argv[2];
  if (typeof fromArg === 'string' && fromArg.length > 0) {
    return fromArg;
  }
  const fromEnv = process.env['ADMIN_USERNAME'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}

function generatePassword(): string {
  // base64url: no padding, URL-safe alphabet. 24 bytes → 32 chars.
  return randomBytes(PASSWORD_BYTES).toString('base64url');
}

function resolveBcryptCost(): number {
  const raw = process.env['BCRYPT_COST'];
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_BCRYPT_COST;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 4 || parsed > 15) {
    process.stderr.write(
      `ERROR: BCRYPT_COST must be an integer between 4 and 15 (got '${raw}').\n`,
    );
    process.exit(1);
  }
  return parsed;
}

async function rotatePassword(username: string, cost: number): Promise<RotateResult> {
  const password = generatePassword();
  const passwordHash = await bcryptMod.hash(password, cost);

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing === null) {
      process.stderr.write(`ERROR: admin user '${username}' not found in database.\n`);
      process.exit(1);
    }
    await prisma.user.update({
      where: { username },
      data: { passwordHash },
    });
    return {
      username,
      password,
      rotatedAt: new Date().toISOString(),
      bcryptCost: cost,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const username = resolveUsername();
  if (username === undefined) {
    process.stderr.write(
      'ERROR: admin username not provided. Set ADMIN_USERNAME env var or pass it as argv[2].\n',
    );
    process.exit(1);
  }

  if (process.env['DATABASE_URL'] === undefined || process.env['DATABASE_URL'].length === 0) {
    process.stderr.write('ERROR: DATABASE_URL env var is required for Prisma to connect.\n');
    process.exit(1);
  }

  const cost = resolveBcryptCost();
  const result = await rotatePassword(username, cost);

  // Emit a single JSON line so callers can pipe through `jq` and capture
  // the cleartext password exactly once.
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ERROR: password rotation failed: ${message}\n`);
  process.exit(1);
});

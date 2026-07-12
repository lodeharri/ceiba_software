#!/usr/bin/env tsx
/**
 * Bootstrap real secrets to AWS SSM Parameter Store before first deploy.
 *
 * Idempotent. Safe to re-run (uses --overwrite). Required because the CDK
 * stacks declare SSM SecureStrings with placeholder values — without real
 * values here, lambdas fail at runtime with placeholder JWT secrets.
 *
 * Reads target stage from CLI: `pnpm bootstrap:secrets dev`
 * Requires AWS credentials in env or ~/.aws/credentials (profile 'default').
 */
import { SSMClient, PutParameterCommand, GetParameterCommand } from '@aws-sdk/client-ssm';
import { randomBytes, randomInt } from 'node:crypto';

const STAGE = process.argv[2] ?? 'dev';
if (!['dev', 'prod'].includes(STAGE)) {
  console.error('Usage: tsx scripts/bootstrap-secrets.ts <dev|prod>');
  process.exit(1);
}

const PREFIX = `/MercadoExpress/${STAGE}`;
const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

function generateJwtSecret(): string {
  // 48 random bytes → base64 (64 chars). HS256 needs at least 32 bytes.
  return randomBytes(48).toString('base64');
}

function generateAdminPassword(): string {
  const SETS = {
    LOWERCASE: 'abcdefghjkmnpqrstuvwxyz',
    UPPERCASE: 'ABCDEFGHJKMNPQRSTUVWXYZ',
    DIGITS: '23456789',
    SYMBOLS: '!@#$%^&*',
  } as const;
  const CHARS_PER_SET = 4;
  const result: string[] = [];
  for (const set of Object.values(SETS)) {
    for (let i = 0; i < CHARS_PER_SET; i++) {
      result.push(set[randomInt(0, set.length)]);
    }
  }
  // Real Fisher-Yates shuffle with crypto.randomInt
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join('');
}

const PLACEHOLDER_VALUES = new Set([
  'placeholder-replaced-by-ops',
  'placeholder-empty-on-first-deploy',
]);

function isParameterNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ParameterNotFound'
  );
}

async function ensureSecret(
  name: string,
  generator: () => string,
  forceRegenerate = false,
): Promise<string> {
  const fullName = `${PREFIX}/${name}`;
  if (!forceRegenerate) {
    try {
      const existing = await ssm.send(
        new GetParameterCommand({ Name: fullName, WithDecryption: true }),
      );
      if (existing.Parameter?.Value && !PLACEHOLDER_VALUES.has(existing.Parameter.Value)) {
        console.log(`[bootstrap] ${fullName}: already set, skipping`);
        return existing.Parameter.Value;
      }
    } catch (err) {
      // ParameterNotFound is expected on first run; fall through to generate.
      if (!isParameterNotFound(err)) throw err;
    }
  }
  const value = generator();
  await ssm.send(
    new PutParameterCommand({
      Name: fullName,
      Value: value,
      Type: 'SecureString',
      Overwrite: true,
      Description: `Bootstrapped by scripts/bootstrap-secrets.ts on ${new Date().toISOString()}`,
    }),
  );
  console.log(`[bootstrap] ${fullName}: created/updated (${value.length} chars)`);
  return value;
}

async function main(): Promise<void> {
  console.log(`[bootstrap] target stage: ${STAGE}`);
  console.log(`[bootstrap] region: ${process.env['AWS_REGION'] ?? 'us-east-1'}`);
  await ensureSecret('jwt-secret', generateJwtSecret);
  await ensureSecret('jwt-secret-previous', () => generateJwtSecret());
  await ensureSecret('admin-password', generateAdminPassword);
  console.log(`[bootstrap] done. Secrets written to SSM under ${PREFIX}/`);
  console.log(
    `[bootstrap] NEXT STEP: run 'pnpm --filter infra exec cdk deploy MercadoExpress-${STAGE} --require-approval never'`,
  );
}

main().catch((err) => {
  console.error('[bootstrap] FATAL:', err);
  process.exit(1);
});

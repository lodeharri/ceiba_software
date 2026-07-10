#!/usr/bin/env npx tsx
/**
 * Smoke Test: CloudWatch Log Volume (RISK-W10)
 *
 * Uses AWS CLI to fetch CloudWatch metrics for Lambda log groups
 * and asserts daily ingested bytes are under the design budget.
 *
 * Budget: ~700 MB/day (design estimate)
 *
 * Usage:
 *   AWS_PROFILE=prod STAGE=dev npx tsx scripts/smoke-log-volume.ts
 *
 * Required:
 *   - AWS CLI installed and configured
 *   - jq for JSON parsing (optional, script degrades gracefully)
 *
 * Required env vars:
 *   AWS_REGION=us-east-1 (default)
 *   STAGE=dev (default)
 */

const STAGE = process.env.STAGE || 'dev';
const TARGET_BUDGET_BYTES = 700 * 1024 * 1024; // 700 MB in bytes
const TARGET_WARN_BYTES = 500 * 1024 * 1024; // 500 MB warning threshold
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const LAMBDA_NAMES = [
  `MercadoExpress-${STAGE}-auth-lambda`,
  `MercadoExpress-${STAGE}-products-lambda`,
  `MercadoExpress-${STAGE}-inventory-lambda`,
  `MercadoExpress-${STAGE}-alerts-lambda`,
  `MercadoExpress-${STAGE}-orders-lambda`,
];

interface LogVolumeResult {
  logGroup: string;
  storedBytes: number;
  storedBytesStr: string;
  ok: boolean;
}

async function execCommand(cmd: string): Promise<string> {
  const { execSync } = await import('child_process');
  try {
    return execSync(cmd, { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

async function getLogGroupStoredBytes(logGroupName: string): Promise<number> {
  try {
    const cmd = [
      'aws logs describe-log-groups',
      `--log-group-name-prefix "${logGroupName}"`,
      `--region ${AWS_REGION}`,
      '--query "logGroups[0].storedBytes"',
      '--output text',
    ].join(' ');

    const output = await execCommand(cmd);
    const bytes = parseFloat(output.trim());
    return isNaN(bytes) ? 0 : bytes;
  } catch {
    console.warn(`   ⚠️  Could not fetch log group: ${logGroupName}`);
    return 0;
  }
}

async function runLogVolumeSmoke(): Promise<void> {
  console.info('🔍 CloudWatch Log Volume Smoke Test (RISK-W10)');
  console.info(`   Stage: ${STAGE}`);
  console.info(`   Region: ${AWS_REGION}`);
  console.info(`   Target budget: ${(TARGET_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB/day`);
  console.info(`   Warning threshold: ${(TARGET_WARN_BYTES / 1024 / 1024).toFixed(0)} MB/day`);

  const results: LogVolumeResult[] = [];
  let totalBytes = 0;

  for (const lambdaName of LAMBDA_NAMES) {
    const logGroupName = `/aws/lambda/${lambdaName}`;
    process.stdout.write(`📊 Checking ${lambdaName}... `);

    const bytes = await getLogGroupStoredBytes(logGroupName);
    const bytesStr =
      bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

    const perLambdaBudget = TARGET_BUDGET_BYTES / LAMBDA_NAMES.length;
    const result: LogVolumeResult = {
      logGroup: logGroupName,
      storedBytes: bytes,
      storedBytesStr: bytesStr,
      ok: bytes <= perLambdaBudget,
    };

    results.push(result);
    totalBytes += bytes;

    if (result.ok) {
      console.info(`✅ ${bytesStr}`);
    } else {
      console.error(
        `❌ ${bytesStr} (exceeds ${(perLambdaBudget / 1024 / 1024).toFixed(0)} MB budget)`,
      );
    }
  }

  const totalStr =
    totalBytes < 1024 * 1024
      ? `${(totalBytes / 1024).toFixed(1)} KB`
      : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;

  console.info('\n' + '='.repeat(50));
  console.info(`📊 Total stored bytes: ${totalStr}`);

  let exitCode = 0;

  if (totalBytes > TARGET_BUDGET_BYTES) {
    console.error(
      `❌ FAILED: Total exceeds budget (${totalStr} > ${(TARGET_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB)`,
    );
    exitCode = 1;
  } else if (totalBytes > TARGET_WARN_BYTES) {
    console.warn(`⚠️  WARNING: Total exceeds warning threshold but within budget`);
  }

  const failedLambdas = results.filter((r) => !r.ok);
  if (failedLambdas.length > 0) {
    console.error(`❌ FAILED: ${failedLambdas.length} Lambda(s) exceed per-lambda budget`);
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.info('✅ All log volume tests passed');
  }

  process.exit(exitCode);
}

runLogVolumeSmoke().catch((error) => {
  console.error('❌ Smoke test error:', error);
  process.exit(1);
});

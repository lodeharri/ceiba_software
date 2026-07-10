#!/usr/bin/env node
/**
 * CDK app entry (PR 1 + PR 2, tasks.md §2 PR 1 + §2 PR 2).
 *
 * PR 2 changes (design.md §3.10):
 *   - When stage='localstack' (or skipRds=true / skipCloudFront=true
 *     context flags are set), skip RDS/VPC and CloudFront/S3. LocalStack
 *     Community does not run those services (R-1 mitigation).
 *   - When DatabaseStack / FrontendStack are skipped, the matching
 *     StageStacks.database / StageStacks.frontend properties are undefined
 *     and downstream addDependency(...) calls are guarded.
 *   - The CORS allow-origin for ApiStack resolves from FRONTEND_ORIGIN when
 *     FrontendStack is skipped, instead of https://${frontend.distributionDomainName}.
 *
 * PR 1 behavior (backward compat for dev and prod):
 *   - The four stacks are instantiated exactly as before.
 *   - Cross-stack references are wired via explicit addDependency calls.
 *
 * Architectural invariant (AD-6): only this entrypoint touches the Stage
 * union for stack selection; no handler/use-case/domain code imports STAGE.
 */

import { App, type StackProps } from 'aws-cdk-lib';
import { resolveStage, type Stage, infraConfig } from './config.js';
import { DatabaseStack } from './stacks/DatabaseStack.js';
import { FrontendStack } from './stacks/FrontendStack.js';
import { ApiStack } from './stacks/ApiStack.js';
import { ObservabilityStack } from './stacks/ObservabilityStack.js';

export const INFRA_PACKAGE_VERSION = '0.0.0-pr2';

export interface StageStacks {
  /** Undefined when stage=localstack or --context skipRds=true. */
  database?: DatabaseStack | undefined;
  /** Undefined when stage=localstack or --context skipCloudFront=true. */
  frontend?: FrontendStack | undefined;
  api: ApiStack;
  observability: ObservabilityStack;
}

function asBool(raw: unknown): boolean {
  return raw === true || raw === 'true';
}

function readContextFlag(app: App, key: string): boolean {
  const value = app.node.tryGetContext(key);
  return asBool(value);
}

function readEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * Instantiates the four stacks for a given stage. Exported so tests can
 * construct a stage's graph without spinning up the CDK App.
 *
 * PR 2: the database and frontend properties are now optional. Callers that
 * need them must null-check (typically only dev/prod need them).
 */
export function createStageStacks(app: App, stage: Stage, props?: StackProps): StageStacks {
  // Synthesizing the DatabaseStack requires account + region for the VPC
  // lookup. We pull them from context (cdk.json or -c flags) and fall
  // back to a deterministic placeholder so cdk synth works locally
  // without AWS credentials.
  const env = props?.env ?? {
    account: app.node.tryGetContext('aws:cdk:env-account') ?? '000000000000',
    region: app.node.tryGetContext('aws:cdk:env-region') ?? infraConfig.region,
  };
  const stackProps: StackProps = { env, ...props };

  // PR 2: skip RDS/VPC and CloudFront/S3 when stage=localstack OR explicit
  // context flags are set. Stage wins: a skipRds=false context flag cannot
  // force-enable RDS for localstack (R-1 mitigation).
  const skipRds = stage === 'localstack' || readContextFlag(app, 'skipRds');
  const skipCloudFront = stage === 'localstack' || readContextFlag(app, 'skipCloudFront');

  const database = skipRds
    ? undefined
    : new DatabaseStack(app, `MercadoExpress-${stage}-Database`, {
        stage,
        ...stackProps,
      });

  // FrontendStack must be created before ApiStack when present, because
  // ApiStack reads FrontendStack.distributionDomainName at synth time.
  const frontend = skipCloudFront
    ? undefined
    : new FrontendStack(app, `MercadoExpress-${stage}-Frontend`, {
        stage,
        ...stackProps,
      });

  // CORS allow-origin: CloudFront distribution when present, else env var.
  // https://${frontend.distributionDomainName} is the AWS path;
  // process.env.FRONTEND_ORIGIN (with http://localhost:5173 fallback) is the
  // localstack path.
  const corsAllowOrigin = frontend
    ? `https://${frontend.distributionDomainName}`
    : readEnvOrDefault('FRONTEND_ORIGIN', 'http://localhost:5173');

  // PR 2: DATABASE_URL source is plain-env for localstack (literal URL),
  // secret-arn for AWS stages (Lambda resolves at cold start).
  const databaseSource =
    stage === 'localstack' || !database
      ? { kind: 'plain-env' as const, databaseUrl: readEnvOrDefault('DATABASE_URL', '') }
      : { kind: 'secret-arn' as const, secretArn: database.databaseUrlSecretArn };

  // PR 2: JWT_SECRET source is plain-env for localstack (literal value),
  // ssm-parameter for AWS stages (Lambda resolves at cold start).
  const jwtSource =
    stage === 'localstack'
      ? {
          kind: 'plain-env' as const,
          secret: readEnvOrDefault('JWT_SECRET', ''),
          previousSecret: readEnvOrDefault('JWT_SECRET_PREVIOUS', ''),
        }
      : {
          kind: 'ssm-parameter' as const,
          parameterName: `/MercadoExpress/${stage}/jwt-secret`,
          previousParameterName: `/MercadoExpress/${stage}/jwt-secret-previous`,
        };

  const api = new ApiStack(app, `MercadoExpress-${stage}-Api`, {
    stage,
    corsAllowOrigin,
    databaseSource,
    jwtSource,
    securityGroupId: database?.securityGroupId ?? '',
    ...stackProps,
  });

  const observability = new ObservabilityStack(app, `MercadoExpress-${stage}-Observability`, {
    stage,
    lambdaFunctionNames: [
      'auth-lambda',
      'products-lambda',
      'inventory-lambda',
      'alerts-lambda',
      'orders-lambda',
    ],
    ...stackProps,
  });

  // Sequencing: database must exist before migrations (migrations Lambda
  // needs the DB to exist); migrations must complete before api (BC Lambdas
  // need the DB schema to be applied); frontend must exist before api
  // (CORS origin). ObservabilityStack depends on api (alarms reference Lambdas).
  // PR 2: every reference to database / frontend is guarded because they
  // may be undefined under localstack.
  if (database) {
    api.node.addDependency(database.migrationsNode);
    api.addDependency(database);
  }
  if (frontend) {
    api.addDependency(frontend);
  }
  observability.addDependency(api);

  return { database, frontend, api, observability };
}

/**
 * Standalone execution: parses -c stage=... and synthesizes the requested
 * stage. Used by cdk synth --all (which iterates over both stages via
 * CDK's stage feature) and by the local synth / deploy:dev scripts.
 */
function main(): void {
  const app = new App();
  const stage = resolveStage(app.node.tryGetContext('stage'));
  createStageStacks(app, stage, {});
}

main();

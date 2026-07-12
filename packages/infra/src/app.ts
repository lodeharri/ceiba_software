#!/usr/bin/env node
/**
 * Loads .env.dev from the repo root before any CDK or config import.
 * @see ../env.ts
 */
import './env.js';

/**
 * CDK app entry (PR 1 + PR 2, tasks.md §2 PR 1 + §2 PR 2).
 *
 * Stack creation order: Database → Api → Frontend → Observability.
 *
 * F-005 stack ordering fix: ApiStack → FrontendStack → ObservabilityStack.
 *   The CORS allow-origin is passed as a stage-specific hardcoded string
 *   (https://{account}.cloudfront.net for dev/prod, localhost for localstack).
 *   This avoids a cross-stack read that would create a cycle:
 *   ApiStack reads frontend.distributionDomainName AND
 *   FrontendStack imports HttpApiUrl from ApiStack = cycle.
 *
 * F-004 fix: FrontendStack imports `MercadoExpress-${stage}-HttpApiUrl` via
 *   Fn.importValue and derives the API Gateway hostname via Fn.split
 *   for the /api/* CloudFront behavior. No prop is passed from app.ts.
 *
 * F-003 fix: ApiStack Lambdas and MigrationsCustomResource receive `vpc`.
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
 * Stack creation order: Database → Api → Frontend → Observability.
 *
 * Deploy order (via addDependency):
 *   Database → Api → Frontend → Observability.
 *
 * CORS allow-origin: passed as a stage-specific string from app.ts to avoid
 * a cross-stack read cycle (FrontendStack imports HttpApiUrl from ApiStack).
 */
export function createStageStacks(app: App, stage: Stage, props?: StackProps): StageStacks {
  const env = props?.env ?? {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
    region: process.env.CDK_DEFAULT_REGION ?? infraConfig.region,
  };
  const stackProps: StackProps = { env, ...props };

  const skipRds = stage === 'localstack' || readContextFlag(app, 'skipRds');
  const skipCloudFront = stage === 'localstack' || readContextFlag(app, 'skipCloudFront');

  // ── DatabaseStack (always first) ─────────────────────────────────────────────
  const database = skipRds
    ? undefined
    : new DatabaseStack(app, `MercadoExpress-${stage}-Database`, {
        stage,
        ...stackProps,
      });

  // CORS allow-origin: hardcoded per stage to avoid a cross-stack read cycle.
  // FrontendStack imports HttpApiUrl from ApiStack; if ApiStack also read
  // frontend.distributionDomainName we would have a cycle.
  // LocalStack uses localhost; AWS stages use '*' — the SPA is served from
  // CloudFront and the Origin header is forwarded to API Gateway, so a
  // wildcard origin satisfies CORS preflight requirements without needing
  // the exact CloudFront domain (which changes per deployment).
  const corsAllowOrigin =
    stage === 'localstack' ? readEnvOrDefault('FRONTEND_ORIGIN', 'http://localhost:5173') : '*';

  const databaseSource =
    stage === 'localstack' || !database
      ? { kind: 'plain-env' as const, databaseUrl: readEnvOrDefault('DATABASE_URL', '') }
      : { kind: 'secret-arn' as const, secretArn: database.databaseUrlSecretArn };

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

  // ── ApiStack ────────────────────────────────────────────────────────────────
  const api = new ApiStack(app, `MercadoExpress-${stage}-Api`, {
    stage,
    corsAllowOrigin,
    databaseSource,
    jwtSource,
    securityGroupId: database?.securityGroupId ?? '',
    vpc: database?.vpc,
    ...stackProps,
  });

  // ── FrontendStack ────────────────────────────────────────────────────────────
  // FrontendStack imports the API Gateway URL from ApiStack via Fn.importValue
  // for the /api/* CloudFront behavior (F-004 fix). No cross-stack read here.
  const frontend = skipCloudFront
    ? undefined
    : new FrontendStack(app, `MercadoExpress-${stage}-Frontend`, {
        stage,
        ...stackProps,
      });

  // ── ObservabilityStack ───────────────────────────────────────────────────────
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

  // ── Dependency wiring ───────────────────────────────────────────────────────
  // Deploy order: Database → Api → Frontend → Observability.
  // Lambdas need DB schema (migrations); FrontendStack CloudFront needs API
  // endpoint (imported via Fn.importValue inside FrontendStack).
  if (database) {
    api.node.addDependency(database.migrationsNode);
    api.addDependency(database);
  }
  if (frontend) {
    frontend.addDependency(api);
  }
  observability.addDependency(api);

  return { database, frontend, api, observability };
}

/**
 * Standalone execution: parses -c stage=... and synthesizes the requested
 * stage. Used by cdk synth --all and the deploy:dev scripts.
 */
function main(): void {
  const app = new App();
  const stage = resolveStage(app.node.tryGetContext('stage'));
  createStageStacks(app, stage, {});
}

main();

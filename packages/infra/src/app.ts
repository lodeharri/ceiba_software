#!/usr/bin/env node
/**
 * CDK app entry (PR 1, tasks.md §2 PR 1).
 *
 * Reads `-c stage=dev|prod` from the CLI (default: `dev`) and instantiates
 * the four stacks for that stage. Cross-stack references (ApiStack needs
 * FrontendStack.distributionDomainName for the CORS allow-origin) are wired
 * via explicit `addDependency` calls so `cdk synth --all` produces a single
 * synth graph per stage.
 *
 * The `INFRA_PACKAGE_VERSION` constant is preserved from PR 0 to keep the
 * workspace smoke test happy (`@mercadoexpress/infra` is importable).
 */

import 'source-map-support/register';
import { App, type StackProps } from 'aws-cdk-lib';
import { resolveStage, type Stage } from './config.js';
import { DatabaseStack } from './stacks/DatabaseStack.js';
import { FrontendStack } from './stacks/FrontendStack.js';
import { ApiStack } from './stacks/ApiStack.js';
import { ObservabilityStack } from './stacks/ObservabilityStack.js';

export const INFRA_PACKAGE_VERSION = '0.0.0-pr1';

export interface StageStacks {
  database: DatabaseStack;
  frontend: FrontendStack;
  api: ApiStack;
  observability: ObservabilityStack;
}

/**
 * Instantiates the four stacks for a given stage. Exported so tests can
 * construct a stage's graph without spinning up the CDK App.
 */
export function createStageStacks(app: App, stage: Stage, props?: StackProps): StageStacks {
  const database = new DatabaseStack(app, `MercadoExpress-${stage}-Database`, { stage, ...props });

  // FrontendStack must be created before ApiStack because ApiStack reads
  // FrontendStack.distributionDomainName at synth time.
  const frontend = new FrontendStack(app, `MercadoExpress-${stage}-Frontend`, { stage, ...props });

  const api = new ApiStack(app, `MercadoExpress-${stage}-Api`, {
    stage,
    distributionDomainName: frontend.distributionDomainName,
    databaseUrlSecretArn: database.databaseUrlSecretArn,
    securityGroupId: database.securityGroupId,
    ...props,
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
    ...props,
  });

  // Sequencing: database must exist before api (FNS read DATABASE_URL);
  // frontend must exist before api (CORS origin). ObservabilityStack
  // depends on api (alarms reference Lambdas).
  api.addDependency(database);
  api.addDependency(frontend);
  observability.addDependency(api);

  return { database, frontend, api, observability };
}

/**
 * Standalone execution: parses `-c stage=...` and synthesizes the requested
 * stage. Used by `cdk synth --all` (which iterates over both stages via
 * CDK's stage feature) and by the local `synth` / `deploy:dev` scripts.
 */
function main(): void {
  const app = new App();
  const stage = resolveStage(app.node.tryGetContext('stage'));
  createStageStacks(app, stage, {});
}

main();

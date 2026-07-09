/**
 * Migrations CustomResource Lambda (PR 1, tasks.md §2 PR 1).
 *
 * On stack create/update, this Lambda runs in one invocation:
 *   1. `npx prisma migrate deploy` against DATABASE_URL.
 *   2. `npx tsx prisma/seed.ts` against DATABASE_URL (idempotent upserts).
 *
 * If either step fails the CustomResource signals FAILED and the stack
 * rollback kicks in. The seed is fully idempotent (per design.md §10.3)
 * so re-running on every deploy is safe.
 *
 * PR 1 ships the wiring; the actual seed body lands in PR 2a (the
 * `seed.ts` construct is a stub that just logs "seed stub, body in PR 2a").
 */

import { Duration, CustomResource, type CustomResourceProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Stage } from '../config.js';

export interface MigrationsCustomResourceProps {
  stage: Stage;
  databaseUrlSecretArn: string;
}

export class MigrationsCustomResource extends Construct {
  public readonly customResource: CustomResource;

  public constructor(scope: Construct, id: string, props: MigrationsCustomResourceProps) {
    super(scope, id);

    const { stage, databaseUrlSecretArn } = props;

    // Lambda that runs the migrations + seed.
    const migrationsFunction = new nodejs.NodejsFunction(this, 'MigrationsFunction', {
      functionName: `MercadoExpress-${stage}-prisma-migrate-and-seed`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: `./migrations-lambda.ts`,
      handler: 'handler',
      memorySize: 1024,
      timeout: Duration.minutes(10),
      environment: {
        STAGE: stage,
        DATABASE_URL: databaseUrlSecretArn,
        ADMIN_USERNAME: 'admin',
        ADMIN_EMAIL: 'admin@mercadoexpress.local',
        ADMIN_PASSWORD: 'change-me-on-first-deploy',
      },
    });

    // The Lambda needs to read the SSM Parameter Store entry holding the
    // DATABASE_URL template. Permissions: ssm:GetParameter + kms:Decrypt.
    migrationsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [databaseUrlSecretArn],
      }),
    );
    migrationsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        // AWS-managed CMK for SSM SecureString — `*` is the documented
        // scope for "alias/aws/ssm".
        resources: ['*'],
      }),
    );

    // CustomResource provider — a singleton SNS-backed provider CDK
    // provisions for us. The `serviceToken` is what wires the provider
    // to our Lambda.
    const provider = new cr.Provider(this, 'MigrationsProvider', {
      onEventHandler: migrationsFunction,
      logRetention: 7,
    });

    const customResourceProps: CustomResourceProps = {
      serviceToken: provider.serviceToken,
      properties: {
        // Re-run on every stack update so additive migrations apply.
        Stage: stage,
        // Force a new run every time the construct is re-created.
        ForceRunId: `${stage}-${Date.now()}`,
      },
    };

    this.customResource = new CustomResource(this, 'PrismaMigrateAndSeed', customResourceProps);
  }
}

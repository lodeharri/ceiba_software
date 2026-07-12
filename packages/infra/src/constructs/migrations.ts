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
import * as path from 'node:path';
import * as url from 'node:url';
import type { Stage } from '../config.js';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface MigrationsCustomResourceProps {
  stage: Stage;
  databaseUrlSecretArn: string;
  /** Name of the SSM SecureString parameter carrying the admin bootstrap password. */
  adminPasswordParameterName: string;
  /** VPC in which to place the migrations Lambda. */
  vpc: ec2.IVpc;
}

export class MigrationsCustomResource extends Construct {
  public readonly customResource: CustomResource;

  public constructor(scope: Construct, id: string, props: MigrationsCustomResourceProps) {
    super(scope, id);

    const { stage, databaseUrlSecretArn, adminPasswordParameterName, vpc } = props;

    // Lambda that runs the migrations + seed.
    // Resolve the entry path relative to this construct file so it works
    // both from source (ts-node) and from dist/ (after tsc build).
    const thisUrl = url.fileURLToPath(import.meta.url);
    const thisDir = path.dirname(thisUrl);
    const migrationsLambdaEntry = path.resolve(thisDir, 'migrations-lambda.js');

    const migrationsFunction = new nodejs.NodejsFunction(this, 'MigrationsFunction', {
      functionName: `MercadoExpress-${stage}-prisma-migrate-and-seed`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: migrationsLambdaEntry,
      handler: 'handler',
      memorySize: 1024,
      timeout: Duration.minutes(15),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      allowPublicSubnet: true,
      environment: {
        STAGE: stage,
        // The Lambda receives the Secrets Manager secret ARN and resolves
        // the actual DATABASE_URL at cold start via GetSecretValue.
        // This keeps the password out of CFN env-var plaintext (BLOCKER C2).
        DATABASE_SECRET_ARN: databaseUrlSecretArn,
        ADMIN_USERNAME: 'admin',
        ADMIN_EMAIL: 'admin@mercadoexpress.local',
        // PR 1 review BLOCKER C3: pull the admin password from the SSM
        // SecureString parameter at cold start — never bake a literal into
        // the CFN env-var block (synthesized CFN previously carried
        // 'change-me-on-first-deploy' as plaintext).
        // Pass the SSM parameter name so the Lambda can read the password at runtime.
        // We pass the raw string (not a CDK token reference) so CDK doesn't try
        // to resolve it at synth time via describeParameters (which fails in CI).
        // The Lambda reads the value via ssm:GetParameter at cold start.
        ADMIN_PASSWORD_PARAM_NAME: adminPasswordParameterName,
      },
    });

    // The Lambda carries the Secrets Manager secret ARN in DATABASE_URL
    // and calls GetSecretValue at cold start to unmarshal the connection
    // string (PR 1 review BLOCKER C2 — the prior flow had a plaintext
    // SSM parameter carrying the resolved URL; we now keep the password
    // in Secrets Manager and out of CFN env-var plaintext).
    migrationsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [databaseUrlSecretArn],
      }),
    );
    // SSM GetParameter permission. We use the parameter name as the resource
    // (SSM supports both name and ARN in iam:GetParameter policy resources).
    migrationsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          // Use the simple-name form so CDK doesn't try to construct the full ARN
          // (which requires a DescribeParameters SDK call that fails in test/CI).
          `arn:aws:ssm:*:*:parameter${adminPasswordParameterName.replace(/^\//, '/')}`,
        ],
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

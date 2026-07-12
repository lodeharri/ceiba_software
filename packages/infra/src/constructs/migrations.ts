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

import { Duration, CustomResource, type CustomResourceProps, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Stage } from '../config.js';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface MigrationsCustomResourceProps {
  stage: Stage;
  databaseUrlSecretArn: string;
  /** ARN of the Secrets Manager secret carrying the admin bootstrap password. */
  adminPasswordSecretArn: string;
  /** VPC in which to place the migrations Lambda. */
  vpc: ec2.IVpc;
}

export class MigrationsCustomResource extends Construct {
  public readonly customResource: CustomResource;

  public constructor(scope: Construct, id: string, props: MigrationsCustomResourceProps) {
    super(scope, id);

    const { stage, databaseUrlSecretArn, adminPasswordSecretArn, vpc } = props;

    // Reference the DB master credentials secret.
    const dbSecretRef = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'MigrationsDbSecretRef',
      databaseUrlSecretArn,
    );
    // Reference the admin password secret.
    const adminPasswordRef = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'MigrationsAdminPasswordRef',
      adminPasswordSecretArn,
    );

    // Build DATABASE_URL via Fn::Join from secret JSON fields.
    // CDK synthesizes {{resolve:secretsmanager:arn:SecretString:field::}} for
    // each secretValueFromJson() token, which CFN resolves at deploy time.
    // The `as unknown[]` cast bridges the gap between TypeScript's `string[]`
    // Fn::join signature and the runtime IResolvable support for SecretValue.
    const migrationsDatabaseUrl = Fn.join('', [
      'postgresql://',
      dbSecretRef.secretValueFromJson('username'),
      ':',
      dbSecretRef.secretValueFromJson('password'),
      '@',
      dbSecretRef.secretValueFromJson('host'),
      ':',
      dbSecretRef.secretValueFromJson('port'),
      '/',
      dbSecretRef.secretValueFromJson('dbname'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    // Lambda that runs the migrations + seed.
    // Resolve the entry path relative to this construct file so it works
    // both from source (ts-node) and from dist/ (after tsc build).
    const thisUrl = url.fileURLToPath(import.meta.url);
    const thisDir = path.dirname(thisUrl);
    const migrationsLambdaEntry = path.resolve(thisDir, 'migrations-lambda.js');

    // Path to the backend prisma directory — resolved at synth time so
    // commandHooks.afterBundling can copy the files into the bundle.
    // thisDir = packages/infra/src/constructs; 4 levels up = workspace root
    // where packages/backend/prisma/ lives.
    const prismaSourceDir = path.resolve(thisDir, '..', '..', '..', '..', 'backend', 'prisma');

    /**
     * DEFINITIVE FIX — self-contained Lambda bundle.
     *
     * The Lambda lives in PRIVATE_ISOLATED subnets with no internet access.
     * Previously it called `npx prisma` and `npx tsx` at runtime, which requires
     * reaching registry.npmjs.org — impossible in this VPC. Additionally, `npx`
     * would download the latest Prisma (7.x), incompatible with Node 20.
     *
     * Solution: install prisma + @prisma/client + tsx into the bundle at CDK
     * synth time. The CDK bundling Docker container runs linux/amd64, so engine
     * binaries are built for the Lambda runtime platform (rhel-openssl-3.0.x).
     *
     * We also run `prisma generate` with a schema that has the output path
     * pointing to `node_modules/@prisma/client/.prisma/client` — a location
     * Node can resolve at Lambda runtime. The original schema.prisma uses a
     * pnpm-store path that only works in the dev environment.
     *
     * See: migrations-lambda.ts for the runtime-side changes (no more npx).
     */
    const PRISMA_VERSION = '5.22.0';
    const TSX_VERSION = '4.19.1';

    const bundling: BundlingOptions = {
      commandHooks: {
        beforeBundling(_inputDir: string, outputDir: string): string[] {
          const schemaIn = `${prismaSourceDir}/schema.prisma`;
          const schemaTmp = `${outputDir}/.schema.prisma`;
          return [
            // Install prisma CLI, @prisma/client (postinstall runs prisma generate),
            // and tsx into the Lambda's node_modules. --ignore-scripts on prisma
            // avoids double-generate; we run it ourselves below with the right output path.
            `npm install --prefix "${outputDir}" --no-save --no-package-lock --ignore-scripts \
              "prisma@${PRISMA_VERSION}" \
              "@prisma/client@${PRISMA_VERSION}" \
              "tsx@${TSX_VERSION}"`,

            // Copy the schema and patch its output path so Node can find the
            // generated client at Lambda runtime (node_modules/@prisma/client/.prisma/client).
            // Original: ../../../node_modules/.pnpm/@prisma+client@5.22.0_.../node_modules/.prisma/client
            // Patched:  ../../node_modules/@prisma/client/.prisma/client  (relative to node_modules/@prisma/client/)
            `cp "${schemaIn}" "${schemaTmp}"`,
            `sed -i 's|output = ".*"|output = "../../node_modules/@prisma/client/.prisma/client"|' "${schemaTmp}"`,

            // Run prisma generate to create the typed client with the Lambda-compatible output path.
            // HOME=/tmp avoids "cannot create /home/sbx_user1051/.cache" errors.
            `HOME=/tmp node "${outputDir}/node_modules/prisma/build/index.js" generate \
              --schema="${schemaTmp}"`,
          ];
        },
        afterBundling(_inputDir: string, outputDir: string): string[] {
          return [
            // Copy the Prisma schema and seed into the bundle. The schema used at
            // runtime is the one copied here; the patched temp schema is discarded.
            `mkdir -p "${outputDir}/backend/prisma"`,
            `cp "${prismaSourceDir}/schema.prisma" "${outputDir}/backend/prisma/"`,
            `cp "${prismaSourceDir}/seed.ts" "${outputDir}/backend/prisma/"`,
          ];
        },
        beforeInstall(): string[] {
          return [];
        },
      },
    };

    const migrationsFunction = new nodejs.NodejsFunction(this, 'MigrationsFunction', {
      functionName: `MercadoExpress-${stage}-prisma-migrate-and-seed`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: migrationsLambdaEntry,
      handler: 'handler',
      memorySize: 1024,
      timeout: Duration.minutes(15),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      // DATABASE_URL: pre-constructed at deploy time via Fn::Join of DB secret
      // fields. No runtime GetSecretValue call (BLOCKER C2 fix).
      // ADMIN_PASSWORD: pre-resolved via SecretValue (no SSM GetParameter call).
      // Both are CDK tokens that resolve to the actual values at deploy time.
      environment: {
        STAGE: stage,
        DATABASE_URL: migrationsDatabaseUrl,
        ADMIN_USERNAME: 'admin',
        ADMIN_EMAIL: 'admin@mercadoexpress.local',
        ADMIN_PASSWORD: adminPasswordRef.secretValue.unsafeUnwrap(),
        // Lambda runtime has no writable $HOME at /home/sbx_user1051.
        // Redirect HOME and npm cache to /tmp (Lambda's writable tmpfs).
        HOME: '/tmp',
        npm_config_cache: '/tmp/.npm',
        npm_config_tmp: '/tmp/.npm-tmp',
      },
      bundling,
    });

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

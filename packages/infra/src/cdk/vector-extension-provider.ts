/**
 * CDK Custom Resource: enables pgvector extension on the RDS app database.
 *
 * Creates a Secrets Manager secret holding the RDS postgres master credentials
 * (username: postgres, password: auto-generated) and grants the setup Lambda
 * read access to it. The Lambda connects as postgres to run:
 *   CREATE EXTENSION IF NOT EXISTS vector;
 *   ALTER TABLE products ALTER COLUMN embedding TYPE vector(768);
 *
 * Safe to re-run: CREATE EXTENSION IF NOT EXISTS is idempotent.
 * The Custom Resource runs ONCE per CDK deploy (Create/Update both succeed).
 * Lambda runs in AWS default VPC (no VPC config needed) — RDS is publicly accessible in dev.
 */
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface VectorExtensionProps {
  /** Stage name used to name resources uniquely. */
  stage: string;
  /** Public endpoint of the RDS instance (passed as env var, NOT a secret). */
  dbHost: string;
}

export class VectorExtension extends Construct {
  constructor(scope: Construct, id: string, props: VectorExtensionProps) {
    super(scope, id);

    const { stage, dbHost } = props;

    // ── 1. Secrets Manager secret: postgres master credentials ───────────────────
    // RDS auto-rotates these. The Lambda reads the current password at runtime.
    const postgresMasterSecret = new Secret(this, 'PostgresMasterSecret', {
      secretName: `MercadoExpress-${stage}-postgres-master`,
      description:
        `MercadoExpress ${stage} postgres master credentials. ` +
        'Used by vector-extension setup Lambda only. Do not use for application connections.',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'password',
        passwordLength: 32,
        excludePunctuation: false,
        includeSpace: false,
      },
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // ── 2. Lambda execution role ───────────────────────────────────────────────
    const handlerRole = new Role(this, 'VectorExtRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for vector-extension-setup Lambda',
    });

    handlerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [postgresMasterSecret.secretArn],
      }),
    );

    // ── 3. Setup Lambda (no VPC — uses AWS default VPC with internet access) ───
    // The Lambda runs in AWS's default VPC, which has internet access.
    // Since RDS is publicly accessible in dev, it can connect directly.
    const handler = new NodejsFunction(this, 'VectorExtHandler', {
      functionName: `MercadoExpress-${stage}-vector-extension`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(path.dirname(fileURLToPath(import.meta.url)), 'vector-extension-handler.js'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: RetentionDays.ONE_DAY,
      role: handlerRole,
    });

    // Set environment variables AFTER construction
    handler.addEnvironment('STAGE', stage);
    handler.addEnvironment('DB_HOST', dbHost);
    handler.addEnvironment('DB_PORT', '5432');
    handler.addEnvironment('POSTGRES_MASTER_SECRET_ARN', postgresMasterSecret.secretArn);

    // ── 4. Custom Resource provider ─────────────────────────────────────────────
    const provider = new Provider(this, 'VectorExtProvider', {
      onEventHandler: handler,
    });

    new CustomResource(this, 'VectorExtResource', {
      serviceToken: provider.serviceToken,
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
  }
}

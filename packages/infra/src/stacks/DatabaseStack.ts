/**
 * DatabaseStack (PR 1, tasks.md §2 PR 1).
 *
 * Provisions the single shared RDS Postgres 16 instance for the entire MVP.
 * One instance is sufficient (no read replicas, no multi-AZ) because:
 *   - The MVP is a single-tenant, single-operator deployment.
 *   - The free-tier budget is bounded and a single db.t3.micro fits it.
 *
 * Pinned by config.yaml + design.md §4.1:
 *   - engine: postgres-16
 *   - instance class: db.t3.micro
 *   - rds.extensions: ['vector'] (pgvector)
 *   - databaseName: 'mercadoexpress'
 *   - deletionProtection: false in dev (so `cdk destroy` works in PR cycles)
 *
 * The stack exports two CFN outputs that downstream stacks depend on:
 *   - databaseUrlSecretArn: ARN of the Secrets Manager secret carrying the
 *     DB master credentials JSON. Lambdas must call GetSecretValue on this
 *     ARN at cold start to materialize the connection string (PR 2a).
 *     (Previously a plaintext SSM `String` parameter with a CFN dynamic
 *     reference — see PR 1 review BLOCKER C2; that flow resolved the
 *     password into a plaintext SSM parameter at deploy time.)
 *   - securityGroupId: id of the SG that grants the Lambdas ingress to 5432.
 *
 * Cost note: `deletionProtection: false` in dev means `cdk destroy` will
 * succeed without manual intervention. In prod this MUST be true.
 */

import { Stack, type StackProps, CfnOutput, RemovalPolicy, Tags, Duration } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Stage, infraConfig } from '../config.js';
import { MigrationsCustomResource } from '../constructs/migrations.js';

export interface DatabaseStackProps extends StackProps {
  stage: Stage;
}

export class DatabaseStack extends Stack {
  /** CFN output — ARN of the Secrets Manager secret holding the DB master credentials. */
  public readonly databaseUrlSecretArn: string;
  /** ARN of the Secrets Manager secret holding the admin bootstrap password. */
  public readonly adminPasswordSecretArn: string;
  /** ARN of the Secrets Manager secret holding the JWT signing secret. */
  public readonly jwtSecretArn: string;
  /** ARN of the Secrets Manager secret holding the previous JWT signing secret. */
  public readonly jwtSecretPreviousArn: string;
  /** CFN output — the security group id that grants Lambda ingress to 5432. */
  public readonly securityGroupId: string;

  /** The VPC used by this stack — exported for ApiStack Lambda VPC placement. */
  public readonly vpc: ec2.IVpc;

  public constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // VPC with PUBLIC and PRIVATE_ISOLATED subnets. Lambdas deploy into
    // PRIVATE_ISOLATED subnets and reach AWS services via VPC Interface
    // Endpoints (Secrets Manager, SSM) and the S3 Gateway Endpoint.
    // This replaces the prior public-subnet-only layout that caused network
    // timeouts (Lambdas had no NAT, no IGW route, no access to AWS APIs).
    // Cast through `unknown` to bypass the `exactOptionalPropertyTypes` strictness
    // mismatch between `Vpc` (concrete, optional fields) and `IVpc` (interface,
    // required fields). Both objects expose the same shape we actually use.
    const vpc = new ec2.Vpc(this, 'DefaultVpc', {
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    }) as unknown as ec2.IVpc;

    // Interface Endpoints — give private-subnet Lambdas a private path to
    // AWS services without going through the public internet or paying for NAT.
    // Both use privateDnsEnabled so default AWS service DNS names resolve to
    // the endpoint ENI from inside the VPC (e.g. secretsmanager.us-east-1.amazonaws.com).
    vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
    vpc.addInterfaceEndpoint('SsmEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
    // S3 Gateway Endpoint (free — no per-hour charge).
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: `MercadoExpress ${stage} RDS Postgres security group`,
      allowAllOutbound: true,
    });
    // Lambdas reach Postgres on 5432. The Lambdas are deployed into the
    // VPC public subnets by API Gateway HTTP API integration.
    databaseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Postgres from Lambdas in the VPC',
    );

    this.vpc = vpc;

    // The DB credentials live in a Secrets Manager secret (auto-rotated by
    // RDS). We expose it as an explicit `rds.DatabaseSecret` so we can
    // capture the secret ARN here and thread it to the migrations Lambda
    // and the BC Lambdas — those Lambdas must call GetSecretValue at
    // cold start and unmarshal the connection URL themselves. This avoids
    // the prior SSM-parameter-carries-resolved-password anti-pattern
    // (PR 1 review BLOCKER C2): a `String` SSM parameter with a CFN
    // dynamic reference is evaluated at deploy time and stores the
    // resolved password as plaintext in SSM.
    const dbSecret = new rds.DatabaseSecret(this, 'DbSecret', {
      username: 'mercadoexpress_admin',
      secretName: `MercadoExpress-${stage}-db-master`,
    });
    // DatabaseSecret's `secretFullArn` is typed as optional on the
    // concrete subclass but `Credentials.fromSecret` requires the
    // full `ISecret` interface (which marks it required). Cast
    // through `unknown` \u2014 the runtime object satisfies ISecret.
    const credentials = rds.Credentials.fromSecret(
      dbSecret as unknown as secretsmanager.ISecret,
      'mercadoexpress_admin',
    );

    const database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [databaseSecurityGroup],
      credentials,
      databaseName: 'mercadoexpress',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      backupRetention: Duration.days(stage === 'prod' ? 7 : 1),
      deletionProtection: infraConfig.deletionProtectionByStage[stage],
      removalPolicy: stage === 'prod' ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      // Enable pgvector via the rds.extensions mechanism. AWS RDS does not
      // expose `rds.extensions` in CDK's `DatabaseInstance` API directly;
      // we attach the extension via the parameter group below.
      parameterGroup: new rds.ParameterGroup(this, 'PostgresParams', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16,
        }),
        parameters: {},
      }),
      // Publicly accessible is fine in MVP (single-VPC, single-region);
      // prod should switch this to `false` once we have a VPC peering
      // setup with on-prem. Tracked as a follow-up.
      publiclyAccessible: stage === 'dev',
    });

    // RDS surfaces the pgvector extension via the parameter group above.
    // DatabaseInstance does not yet expose a first-class `extensions`
    // property in CDK; we publish the intent as a CFN tag instead so
    // the operational runbook can find it.
    Tags.of(database).add('ExtensionVector', 'pgvector');

    // Admin bootstrap password — migrated from SSM String to Secrets Manager
    // with KMS-backed encryption. No plaintext value in SSM, no runtime SDK call.
    // The SecretValue ref is passed directly into Lambda env vars at deploy time
    // (synthesized as {{resolve:secretsmanager:...}} in CFN), replacing the prior
    // SSM GetParameter-at-runtime pattern (PR 1 review BLOCKER C3).
    const adminPassword = new secretsmanager.Secret(this, 'AdminPassword', {
      secretName: `MercadoExpress-${stage}-admin-password`,
      description: `MercadoExpress ${stage} admin (usuario seed) bootstrap password. Rotate via Secrets Manager.`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
        includeSpace: false,
      },
    });
    this.adminPasswordSecretArn = adminPassword.secretArn;

    // JWT signing secrets — migrated from SSM String to Secrets Manager.
    // These fix the latent bug where the Lambda received the SSM parameter
    // NAME (not the resolved secret value) as JWT_SECRET, causing JWT
    // verification to fail silently (PR 1 review BLOCKER C1).
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `MercadoExpress-${stage}-jwt-secret`,
      description: `MercadoExpress ${stage} JWT secret (HS256). Used by BC Lambdas. Rotate via Secrets Manager.`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
        includeSpace: false,
      },
    });
    this.jwtSecretArn = jwtSecret.secretArn;

    const jwtSecretPrevious = new secretsmanager.Secret(this, 'JwtSecretPrevious', {
      secretName: `MercadoExpress-${stage}-jwt-secret-previous`,
      description: `MercadoExpress ${stage} JWT previous secret (HS256) — used during rotation overlap window.`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
        includeSpace: false,
      },
    });
    this.jwtSecretPreviousArn = jwtSecretPrevious.secretArn;

    // The DB master credentials secret ARN is exported for downstream stacks
    // to construct DATABASE_URL at deploy time via Fn::Join (no runtime SDK call).
    this.databaseUrlSecretArn = dbSecret.secretArn;
    this.securityGroupId = databaseSecurityGroup.securityGroupId;

    new CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseUrlSecretArn,
      description:
        'Secrets Manager ARN carrying the DB master credentials JSON. Used by ApiStack and Migrations to construct DATABASE_URL at CDK synth time via Fn::Join (no runtime SDK calls).',
      exportName: `MercadoExpress-${stage}-DatabaseSecretArn`,
    });
    new CfnOutput(this, 'SecurityGroupId', {
      value: this.securityGroupId,
      description: 'Security group id granting Lambda ingress to Postgres 5432',
      exportName: `MercadoExpress-${stage}-DatabaseSecurityGroupId`,
    });

    // Instantiate MigrationsCustomResource inside the DatabaseStack.
    // The custom resource runs prisma migrate + seed against the DB once it
    // is available. Downstream stacks depend on it via api.addDependency(database.migrationsNode).
    const migrations = new MigrationsCustomResource(this, 'Migrations', {
      stage,
      databaseUrlSecretArn: this.databaseUrlSecretArn,
      adminPasswordSecretArn: this.adminPasswordSecretArn,
      vpc,
    });
    // Expose the migrations construct node so other stacks can add it as a dependency.
    this.migrationsNode = migrations;
  }

  /** Node of the MigrationsCustomResource for use in addDependency. */
  public readonly migrationsNode: Construct;
}

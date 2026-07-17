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
// MigrationsCustomResource removed — migrations now run in GitHub Actions CI (migrate.yml).

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
  /** VPC ID exported as CfnOutput so ApiStack can import it locally (avoids IVpc cross-stack ref). */
  public readonly vpcId: string;
  /** IDs of PRIVATE_ISOLATED subnets — stored as string array to avoid cross-stack vpc.selectSubnets() call. */
  public readonly isolatedSubnetIds: string[];

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
      // Use a non-default CIDR to avoid conflict with the orphaned VPC
      // (`vpc-09cafc3829bbe5646`, 10.0.0.0/16) whose zombie Lambda ENIs
      // are still in 'in-use' state. After AWS GCs the ENIs, the old VPC
      // can be deleted and we can revert to 10.0.0.0/16.
      cidr: '172.31.0.0/16',
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

    // Allow Lambda functions (outside VPC) to connect when dev
    if (stage !== 'prod') {
      databaseSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(5432),
        'Postgres from Lambda (dev only, no VPC)',
      );
    }

    this.vpc = vpc;
    this.vpcId = vpc.vpcId;
    this.isolatedSubnetIds = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    }).subnetIds;

    // The DB credentials live in a Secrets Manager secret (auto-rotated by
    // RDS). We expose it as an explicit `rds.DatabaseSecret` so we can
    // capture the secret ARN here and thread it to the migrations Lambda
    // and the BC Lambdas — those Lambdas must call GetSecretValue at
    // cold start and unmarshal the connection URL themselves. This avoids
    // the prior SSM-parameter-carries-resolved-password anti-pattern
    // (PR 1 review BLOCKER C2): a `String` SSM parameter with a CFN
    // dynamic reference is evaluated at deploy time and stores the
    // resolved password as plaintext in SSM.
    // NOTE: `secretName` is intentionally set so the CloudFormation physical name
    // matches the Name property. This is required for the Lambda's
    // `{{resolve:secretsmanager:...}}` dynamic references to resolve correctly
    // at deploy time. When `secretName` is omitted, CDK generates a hashed
    // physical name that diverges from the Name, breaking the resolution.
    // v2 suffix avoids collision with secrets in PendingDeletion state from
    // prior failed deploys.
    const dbSecret = new rds.DatabaseSecret(this, 'DbSecret', {
      username: 'mercadoexpress_admin',
      secretName: `MercadoExpress-${stage}-db-credentials-v2`,
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
      // pgvector is installed via the default_extensions parameter, not
      // shared_preload_libraries. Removing vector from shared_preload_libraries
      // (which is only for session-level preloaded libs like pgaudit/pg_stat_statements).
      // pgvector is loaded per-session via CREATE EXTENSION in migrations.
      // Publicly accessible is fine in MVP (single-VPC, single-region);
      // prod should switch this to `false` once we have a VPC peering
      // setup with on-prem. Tracked as a follow-up.
      publiclyAccessible: stage !== 'prod',
    });

    // RDS surfaces the pgvector extension via the parameter group above.
    // DatabaseInstance does not yet expose a first-class `extensions`
    // property in CDK; we publish the intent as a CFN tag instead so
    // the operational runbook can find it.
    Tags.of(database).add('ExtensionVector', 'pgvector');
    // Temporary tag to force RDS recreation after manual deletion (drift remediation)
    Tags.of(database).add('MigratedAt', '2026-07-17T18:30:00Z');

    // Admin bootstrap password — migrated from SSM String to Secrets Manager
    // with KMS-backed encryption. No plaintext value in SSM, no runtime SDK call.
    // The SecretValue ref is passed directly into Lambda env vars at deploy time
    // (synthesized as {{resolve:secretsmanager:...}} in CFN), replacing the prior
    // SSM GetParameter-at-runtime pattern (PR 1 review BLOCKER C3).
    const adminPassword = new secretsmanager.Secret(this, 'AdminPassword', {
      secretName: `MercadoExpress-${stage}-admin-password`,
      description: `MercadoExpress ${stage} admin (usuario seed) bootstrap password. Stored as JSON {"password":"..."}. Rotate via Secrets Manager.`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
        includeSpace: false,
        secretStringTemplate: JSON.stringify({
          password: 'placeholder-will-be-overwritten-by-cdk',
        }),
        generateStringKey: 'password',
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
      description: `MercadoExpress ${stage} JWT previous secret (HS256) — rotation overlap window. [recreated]`,
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

    new CfnOutput(this, 'VpcId', {
      value: this.vpcId,
      description: 'VPC ID for ApiStack Lambda VPC placement',
      exportName: `MercadoExpress-${stage}-DatabaseVpcId`,
    });

    new CfnOutput(this, 'JwtSecretArn', {
      value: this.jwtSecretArn,
      description: 'ARN of the JWT signing secret in Secrets Manager',
      exportName: `MercadoExpress-${stage}-JwtSecretArn`,
    });
    new CfnOutput(this, 'JwtSecretPreviousArn', {
      value: this.jwtSecretPreviousArn,
      description: 'ARN of the previous JWT signing secret (rotation overlap)',
      exportName: `MercadoExpress-${stage}-JwtSecretPreviousArn`,
    });

    // Export isolated subnet IDs individually so ApiStack can import via Fn::ImportValue
    // (avoids passing IVpc or subnet IDs as cross-stack references).
    this.isolatedSubnetIds.forEach((subnetId, i) => {
      new CfnOutput(this, `IsolatedSubnetId${i}`, {
        value: subnetId,
        description: `Isolated subnet ID ${i} for ApiStack Lambda VPC placement`,
        exportName: `MercadoExpress-${stage}-IsolatedSubnetId${i}`,
      });
    });

    // Migrations run in GitHub Actions CI (.github/workflows/migrate.yml).
    // No Custom Resource needed — removes the Lambda + provider from the stack.
    this.migrationsNode = this;
  }

  /** Node for use in addDependency (stack itself — no migrations Lambda needed). */
  public readonly migrationsNode: Construct;
}

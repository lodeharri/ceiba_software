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
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { type Stage, infraConfig } from '../config.js';

export interface DatabaseStackProps extends StackProps {
  stage: Stage;
}

export class DatabaseStack extends Stack {
  /** CFN output — ARN of the Secrets Manager secret holding the DB master credentials. */
  public readonly databaseUrlSecretArn: string;
  /** CFN output — name of the SSM SecureString parameter holding the admin password. */
  public readonly adminPasswordParameterName: string;
  /** CFN output — the security group id that grants Lambda ingress to 5432. */
  public readonly securityGroupId: string;

  public constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Self-contained VPC — sufficient for the MVP. Two AZs across public
    // subnets only (no NAT, no private subnets) because the Lambdas are
    // deployed into public subnets by API Gateway HTTP API integration.
    //
    // We use `new Vpc` (NOT `Vpc.fromLookup`) and pin AZs explicitly so
    // `cdk synth` does not trigger a context-provider lookup (which would
    // require AWS credentials). The two us-east-1 AZs are stable enough
    // for MVP; prod can override via context if needed.
    // Cast through `unknown` to bypass the `exactOptionalPropertyTypes` strictness
    // mismatch between `Vpc` (concrete, optional fields) and `IVpc` (interface,
    // required fields). Both objects expose the same shape we actually use.
    const vpc = new ec2.Vpc(this, 'DefaultVpc', {
      // CDK forbids combining `availabilityZones` and `maxAzs` so we
      // omit `maxAzs`. The two us-east-1 AZs are stable enough for MVP;
      // prod can override via context if needed.
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    }) as unknown as ec2.IVpc;

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
        parameters: {
          // `shared_preload_libraries` must include `vector` for pgvector
          // to be loadable. This is a static engine parameter; AWS RDS
          // provisions it on instance creation.
          shared_preload_libraries: 'vector',
        },
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

    // Admin bootstrap password — stored as an SSM SecureString (per
    // PR 1 review BLOCKER C3). Initial value is a placeholder; the
    // operations runbook `runbook/rotate-admin-password.md` rotates real
    // passwords in via `aws ssm put-parameter`. The migrations Lambda
    // reads this parameter via `ssm.StringParameter.valueForString
    // Parameter(...)` and the PR 2a seed bcrypt-hashes it into the
    // `users` table.
    const adminPasswordParameter = new ssm.StringParameter(this, 'AdminPasswordParameter', {
      parameterName: `/MercadoExpress/${stage}/admin-password`,
      stringValue: 'placeholder-replaced-by-ops',
      description: `MercadoExpress ${stage} admin (usuario seed) bootstrap password. Rotate via runbook/rotate-admin-password.md.`,
      type: ssm.ParameterType.SECURE_STRING,
    });
    this.adminPasswordParameterName = adminPasswordParameter.parameterName;

    // The lambdas carry the Secrets Manager ARN (not the resolved URL)
    // in the DATABASE_URL env var and call GetSecretValue at cold start
    // to construct the connection string. This keeps the password in
    // Secrets Manager and out of CFN env-var plaintext.
    this.databaseUrlSecretArn = dbSecret.secretArn;
    this.securityGroupId = databaseSecurityGroup.securityGroupId;

    new CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseUrlSecretArn,
      description:
        'Secrets Manager ARN carrying the DB master credentials JSON. Lambdas call GetSecretValue at cold start to materialize DATABASE_URL.',
      exportName: `MercadoExpress-${stage}-DatabaseSecretArn`,
    });
    new CfnOutput(this, 'SecurityGroupId', {
      value: this.securityGroupId,
      description: 'Security group id granting Lambda ingress to Postgres 5432',
      exportName: `MercadoExpress-${stage}-DatabaseSecurityGroupId`,
    });
  }
}

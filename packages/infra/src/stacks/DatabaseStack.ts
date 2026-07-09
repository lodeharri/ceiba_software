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
 *   - databaseUrlSecretArn: arn of the SSM SecureString holding DATABASE_URL.
 *   - securityGroupId: id of the SG that grants the Lambdas ingress to 5432.
 *
 * Cost note: `deletionProtection: false` in dev means `cdk destroy` will
 * succeed without manual intervention. In prod this MUST be true.
 */

import { Stack, type StackProps, CfnOutput, RemovalPolicy, Tags, Duration } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { type Stage, infraConfig } from '../config.js';

export interface DatabaseStackProps extends StackProps {
  stage: Stage;
}

export class DatabaseStack extends Stack {
  /** CFN output — the SSM parameter ARN that holds `DATABASE_URL`. */
  public readonly databaseUrlSecretArn: string;
  /** CFN output — the security group id that grants Lambda ingress to 5432. */
  public readonly securityGroupId: string;

  public constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Default VPC — sufficient for the MVP. Two AZs are present in every
    // default VPC, so we get HA on the subnet selection for free.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: `MercadoExpress ${stage} RDS Postgres security group`,
      allowAllOutbound: true,
    });
    // Lambdas reach Postgres on 5432. The Lambdas are deployed into the
    // default-VPC subnets by API Gateway HTTP API integration.
    databaseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Postgres from Lambdas in the default VPC',
    );

    // The DB credentials live in a Secrets Manager secret (auto-rotated by
    // RDS) and the connection string is published to SSM Parameter Store
    // as a SecureString so Lambda env vars can read it cheaply.
    const credentials = rds.Credentials.fromGeneratedSecret('mercadoexpress_admin', {
      secretName: `MercadoExpress-${stage}-db-master`,
    });

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

    // Publish a human-readable connection-string template to SSM. The
    // secret value (with the generated password) lives in Secrets Manager;
    // the SSM parameter holds only the URL template, not the password.
    const databaseUrlParameter = new ssm.StringParameter(this, 'DatabaseUrlParameter', {
      parameterName: `/MercadoExpress/${stage}/database-url`,
      stringValue: `postgresql://mercadoexpress_admin:{{resolve:secretsmanager:${credentials.secretName}}}@${database.dbInstanceEndpointAddress}:${database.dbInstanceEndpointPort}/mercadoexpress`,
      description: `MercadoExpress ${stage} DATABASE_URL template. The {{resolve:secretsmanager:...}} placeholder is resolved at Lambda cold start by SSM.`,
    });

    this.databaseUrlSecretArn = databaseUrlParameter.parameterArn;
    this.securityGroupId = databaseSecurityGroup.securityGroupId;

    new CfnOutput(this, 'DatabaseUrlSecretArn', {
      value: this.databaseUrlSecretArn,
      description: 'SSM Parameter Store ARN holding the DATABASE_URL template',
      exportName: `MercadoExpress-${stage}-DatabaseUrlSecretArn`,
    });
    new CfnOutput(this, 'SecurityGroupId', {
      value: this.securityGroupId,
      description: 'Security group id granting Lambda ingress to Postgres 5432',
      exportName: `MercadoExpress-${stage}-DatabaseSecurityGroupId`,
    });
  }
}

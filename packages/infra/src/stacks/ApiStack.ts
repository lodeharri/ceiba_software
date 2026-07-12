/**
 * ApiStack (PR 1 + PR 2 + PR 2a, tasks.md §2 PR 1 + §2 PR 2 + PR 2a).
 *
 * Provisions:
 *   - HTTP API v2 with `corsPreflight` block (RISK-002) wired to the
 *     CloudFront distribution domain captured at synth time.
 *   - Per-BC NodejsFunctions with JWT middleware on every protected
 *     route (`/api/v1/products/*`, `/api/v1/categories/*`).
 *   - Auth Lambda on `/api/v1/auth/login` (NO JWT middleware).
 *   - 5 CloudWatch Log Groups with 7-day retention (ADR-7).
 *   - Reserved concurrency per stage (1 in dev, default in prod per ADR-9).
 *   - Default throttle 100 / 50 from config.ts.
 *   - JWT secret + previous-secret SSM SecureStrings (C1 closeout).
 *   - DATABASE_URL route through Secrets Manager dynamic ref (C2 closeout).
 *   - ADMIN_PASSWORD SSM SecureString (C3 closeout).
 *
 * PR 2 changes (design.md §3.11):
 *   - `corsAllowOrigin` replaces the CloudFront-specific
 *     `distributionDomainName` prop. The caller passes a fully-qualified
 *     origin string (e.g. `https://d123.cloudfront.net` or
 *     `http://localhost:5173`).
 *   - `databaseSource` is a discriminated union: `{ kind: 'plain-env',
 *     databaseUrl }` for localstack (the Lambda receives the literal URL
 *     in its env), or `{ kind: 'secret-arn', secretArn }` for AWS stages
 *     (the Lambda calls GetSecretValue at cold start).
 *
 * Categories BC handler is merged into the products Lambda (PR 2a
 * decision per design.md §2.1) — both share the same Prisma client,
 * read the same DATABASE_SECRET_ARN, and are unit-tested independently
 * by their own bootstrap (the routes are separate HTTP routes; the
 * Lambda does not need to know about BC boundaries).
 */

import { Stack, type StackProps, CfnOutput, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Stage, infraConfig } from '../config.js';

function backendHandlerPath(handlerFile: string): string {
  const here = fileURLToPath(import.meta.url);
  // Compiled file lives at `dist/src/stacks/ApiStack.js`; the source tree
  // is `packages/backend/src/<bc>/interface/handlers/<name>.ts`.
  return path.resolve(path.dirname(here), '..', '..', '..', '..', 'backend', 'src', handlerFile);
}
export interface ApiStackProps extends StackProps {
  stage: Stage;
  /**
   * Fully-qualified CORS allow-origin (e.g. `https://d123.cloudfront.net`
   * for AWS, `http://localhost:5173` for localstack). Renamed from the
   * CloudFront-specific `distributionDomainName` so the same prop works
   * for non-CloudFront origins.
   */
  corsAllowOrigin?: string | undefined;
  /**
   * PR 2: how the BC Lambdas receive `DATABASE_URL`. `plain-env` carries
   * the literal URL in the Lambda env (localstack); `secret-arn` carries
   * the Secrets Manager ARN so the Lambda resolves the URL at cold start
   * via GetSecretValue (dev/prod). Defaults to a `secret-arn` source
   * built from the legacy `databaseUrlSecretArn` prop for backward compat.
   */
  databaseSource?: DatabaseSource | undefined;
  /**
   * PR 2: how the BC Lambdas receive `JWT_SECRET` / `JWT_SECRET_PREVIOUS`.
   * `plain-env` carries the literals (localstack); `ssm-parameter` carries
   * SSM SecureString parameter names (deprecated — jwtSecretArn wins when both are set).
   */
  jwtSource?: JwtSource | undefined;
  /** ARN of the JWT secret in Secrets Manager (NEW — replaces ssm.StringParameter pattern). */
  jwtSecretArn?: string | undefined;
  /** ARN of the previous JWT secret in Secrets Manager (for rotation overlap window). */
  jwtSecretPreviousArn?: string | undefined;
  /** Database security group id (passed through from DatabaseStack). */
  securityGroupId?: string | undefined;
  /** VPC for Lambda placement (passed from DatabaseStack). */
  vpc?: ec2.IVpc | undefined;
  /** @deprecated Use `corsAllowOrigin` (full origin string). Kept for
   *  callers that have not migrated yet; when both are provided,
   *  `corsAllowOrigin` wins. */
  distributionDomainName?: string | undefined;
  /** @deprecated Use `databaseSource.kind === 'secret-arn'`. Kept for
   *  callers that have not migrated yet; when `databaseSource` is
   *  absent, a secret-arn source is built from this ARN. */
  databaseUrlSecretArn?: string | undefined;
}

export type DatabaseSource =
  { kind: 'plain-env'; databaseUrl: string } | { kind: 'secret-arn'; secretArn: string };

export type JwtSource =
  | { kind: 'plain-env'; secret: string; previousSecret: string }
  | { kind: 'ssm-parameter'; parameterName: string; previousParameterName: string };

export interface LambdaSpec {
  id: string;
  functionName: string;
  /** The handler entry file in `packages/backend/src/<sourceBc>/...` */
  entry: string;
  /** Whether the Lambda needs JWT middleware on every route. */
  requiresJwt: boolean;
  /** Route map: path → method[] for this Lambda. */
  routes: Array<{ path: string; methods: apigwv2.HttpMethod[] }>;
}

/**
 * PR 2a: only `auth` and `products`+`categories` are wired with real
 * handlers; `inventory`, `alerts`, `orders` still resolve to the
 * placeholder and land in PR 2b/2c.
 */
export const LAMBDAS: readonly LambdaSpec[] = [
  {
    id: 'AuthLambda',
    functionName: 'auth-lambda',
    entry: backendHandlerPath('auth/interface/handlers/bootstrap.ts'),
    requiresJwt: false,
    routes: [{ path: '/api/v1/auth/login', methods: [apigwv2.HttpMethod.POST] }],
  },
  {
    id: 'ProductsLambda',
    functionName: 'products-lambda',
    // The Lambda entry is the products BC's `bootstrap.ts`, which
    // re-exports the shared dispatcher (design.md §2.1: categories
    // co-hosted with products). The dispatcher wires JWT verification
    // internally so API Gateway needs no authorizer on these routes.
    entry: backendHandlerPath('products/interface/handlers/bootstrap.ts'),
    requiresJwt: true,
    routes: [
      { path: '/api/v1/products', methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET] },
      {
        path: '/api/v1/products/{id}',
        methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH],
      },
      { path: '/api/v1/categories', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST] },
    ],
  },
  {
    id: 'InventoryLambda',
    functionName: 'inventory-lambda',
    entry: backendHandlerPath('inventory/interface/handlers/bootstrap.ts'),
    requiresJwt: true,
    routes: [
      {
        path: '/api/v1/products/{id}/movements',
        methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      },
    ],
  },
  {
    id: 'AlertsLambda',
    functionName: 'alerts-lambda',
    entry: backendHandlerPath('alerts/interface/handlers/bootstrap.ts'),
    requiresJwt: true,
    routes: [
      { path: '/api/v1/alerts', methods: [apigwv2.HttpMethod.GET] },
      { path: '/api/v1/alerts/{id}', methods: [apigwv2.HttpMethod.GET] },
    ],
  },
  {
    id: 'OrdersLambda',
    functionName: 'orders-lambda',
    entry: backendHandlerPath('shared/dispatchers/orders-dispatcher.ts'),
    requiresJwt: true,
    routes: [
      { path: '/api/v1/orders', methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET] },
      { path: '/api/v1/orders/{id}', methods: [apigwv2.HttpMethod.GET] },
      { path: '/api/v1/orders/{id}/approve', methods: [apigwv2.HttpMethod.POST] },
      { path: '/api/v1/orders/{id}/reject', methods: [apigwv2.HttpMethod.POST] },
      { path: '/api/v1/orders/{id}/receive', methods: [apigwv2.HttpMethod.POST] },
    ],
  },
] as const;

export class ApiStack extends Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly lambdaFns: Record<string, lambda.Function>;

  public constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      stage,
      corsAllowOrigin: explicitCorsAllowOrigin,
      distributionDomainName,
      databaseSource: explicitDatabaseSource,
      databaseUrlSecretArn,
      jwtSecretArn,
      jwtSecretPreviousArn,
      securityGroupId,
    } = props;

    // CORS allow-origin: prefer the explicit full origin (PR 2 contract);
    // fall back to the CloudFront-specific distributionDomainName for
    // callers that have not migrated to the new prop yet.
    const corsAllowOrigin =
      explicitCorsAllowOrigin ??
      (distributionDomainName ? `https://${distributionDomainName}` : '');
    const corsAllowOrigins = [corsAllowOrigin];

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `MercadoExpress-${stage}-HttpApi`,
      description: `MercadoExpress ${stage} HTTP API v2`,
      corsPreflight: {
        allowOrigins: corsAllowOrigins,
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: infraConfig.cors.allowedHeaders,
        allowCredentials: infraConfig.cors.allowCredentials,
        maxAge: Duration.seconds(infraConfig.cors.preflightMaxAgeSeconds),
      },
    });

    // Default throttle (HTTP API v2): 100 burst / 50 steady.
    const cfnStage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (cfnStage) {
      cfnStage.defaultRouteSettings = {
        throttlingBurstLimit: infraConfig.apiThrottling.burst,
        throttlingRateLimit: infraConfig.apiThrottling.steady,
      };
    }

    // PR 2: branch the DATABASE_URL wiring at the adapter boundary.
    // `plain-env` carries a literal URL (localstack); `secret-arn` constructs
    // DATABASE_URL via Fn::Join from the DB secret JSON fields at synth time.
    const databaseSource: DatabaseSource =
      explicitDatabaseSource ??
      (databaseUrlSecretArn !== undefined
        ? { kind: 'secret-arn', secretArn: databaseUrlSecretArn }
        : { kind: 'secret-arn', secretArn: '' });

    // Build DATABASE_URL via Fn::Join from secret fields. CDK emits
    // {{resolve:secretsmanager:arn:SecretString:field::}} for each token; CFN
    // resolves them at deploy time. No runtime GetSecretValue call.
    const databaseUrlValue =
      databaseSource.kind === 'plain-env'
        ? databaseSource.databaseUrl
        : (() => {
            // CDK's Fn.join signature is typed `string[]` but accepts IResolvable tokens
            // at runtime. Suppress lint for the local array cast.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const urlParts: any[] = [
              'postgresql://',
              secretsmanager.Secret.fromSecretCompleteArn(
                this,
                'DbSecretRef',
                databaseSource.secretArn,
              ).secretValueFromJson('username'),
              ':',
              secretsmanager.Secret.fromSecretCompleteArn(
                this,
                'DbSecretRef',
                databaseSource.secretArn,
              ).secretValueFromJson('password'),
              '@',
              secretsmanager.Secret.fromSecretCompleteArn(
                this,
                'DbSecretRef',
                databaseSource.secretArn,
              ).secretValueFromJson('host'),
              ':',
              secretsmanager.Secret.fromSecretCompleteArn(
                this,
                'DbSecretRef',
                databaseSource.secretArn,
              ).secretValueFromJson('port'),
              '/',
              secretsmanager.Secret.fromSecretCompleteArn(
                this,
                'DbSecretRef',
                databaseSource.secretArn,
              ).secretValueFromJson('dbname'),
            ];
            return Fn.join('', urlParts);
          })();

    // JWT secrets — direct SecretValue refs from Secrets Manager ARNs passed
    // as props. CDK synthesises {{resolve:secretsmanager:...}} in the template.
    const jwtSecretRef =
      jwtSecretArn !== undefined
        ? secretsmanager.Secret.fromSecretCompleteArn(this, 'JwtSecretRef', jwtSecretArn)
        : null;
    const jwtSecretPreviousRef =
      jwtSecretPreviousArn !== undefined
        ? secretsmanager.Secret.fromSecretCompleteArn(
            this,
            'JwtSecretPreviousRef',
            jwtSecretPreviousArn,
          )
        : null;

    const reservedConcurrency = infraConfig.reservedConcurrencyByStage[stage];

    const logGroups: logs.LogGroup[] = LAMBDAS.map((l) => {
      const logGroup = new logs.LogGroup(this, `${l.id}LogGroup`, {
        logGroupName: `/aws/lambda/MercadoExpress-${stage}-${l.functionName}`,
        retention: infraConfig.logRetentionDays as logs.RetentionDays,
        removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
      return logGroup;
    });

    this.lambdaFns = {};
    LAMBDAS.forEach((l, i) => {
      const logGroup = logGroups[i];
      if (!logGroup) return;
      const fn = new nodejs.NodejsFunction(this, l.id, {
        functionName: `MercadoExpress-${stage}-${l.functionName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: l.entry,
        handler: 'handler',
        logGroup,
        memorySize: 512,
        timeout: Duration.seconds(10),
        // `bcryptjs` is pure JS — no native bindings, no external bundling needed.
        // Only `aws-sdk` remains external (injected at Lambda runtime).
        bundling: {
          externalModules: ['aws-sdk'],
        },
        ...(props.vpc
          ? {
              vpc: props.vpc,
              vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            }
          : {}),
        environment: {
          STAGE: stage,
          DATABASE_URL: databaseUrlValue,
          JWT_SECRET: jwtSecretRef?.secretValue.unsafeUnwrap() ?? 'placeholder-replaced-by-ops',
          JWT_SECRET_PREVIOUS:
            jwtSecretPreviousRef?.secretValue.unsafeUnwrap() ?? 'placeholder-empty-on-first-deploy',
          JWT_OVERLAP_SECONDS: '3600',
          TRUSTED_PROXY_DEPTH: '0',
          LOG_LEVEL: 'info',
          BCRYPT_COST: '10',
        },
        ...(reservedConcurrency !== undefined
          ? { reservedConcurrentExecutions: reservedConcurrency }
          : {}),
      });
      this.lambdaFns[l.id] = fn;
    });

    // Routes. Each BC lambda routes its declared paths; no JWT middleware
    // is applied at the API Gateway level — the JWT verification happens
    // INSIDE each Lambda (per design.md §2.1, "No Lambda authorizer").
    // Auth Lambda does NOT require a Bearer token (it issues them).
    for (const l of LAMBDAS) {
      const fn = this.lambdaFns[l.id];
      if (!fn) continue;
      const integration = new HttpLambdaIntegration(`${l.id}-Integration`, fn);
      for (const r of l.routes) {
        this.httpApi.addRoutes({
          path: r.path,
          methods: r.methods,
          integration,
        });
      }
    }

    new CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API base URL',
      exportName: `MercadoExpress-${stage}-HttpApiUrl`,
    });
    new CfnOutput(this, 'SecurityGroupIdImport', {
      value: securityGroupId ?? '',
      description: 'Database security group id (passed through from DatabaseStack)',
    });
  }
}

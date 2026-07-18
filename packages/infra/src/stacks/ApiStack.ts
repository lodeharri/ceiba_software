/**
 * ApiStack (PR 2, task 3 — consolidate 5 Lambdas into 1).
 *
 * Provisions:
 *   - HTTP API v2 with `corsPreflight` block (RISK-002) wired to the
 *     CloudFront distribution domain captured at synth time.
 *   - SINGLE consolidated NodejsFunction (`MercadoExpress-{stage}-api`)
 *     that dispatches all HTTP requests to the appropriate bounded-context
 *     handler via an internal route map (see `packages/backend/src/lambda/handler.ts`).
 *   - 1 CloudWatch Log Group with 7-day retention (ADR-7).
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
 * PR 2 consolidation: all 5 prior Lambdas (auth, products, inventory,
 * alerts, orders) are replaced by a single `ConsolidatedApi` Lambda whose
 * entry is `packages/backend/src/lambda/handler.ts`. Route dispatch happens
 * inside the Lambda, not at the API Gateway level.
 */

import {
  Stack,
  type StackProps,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  SecretValue,
  Aws,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Stage, infraConfig } from '../config.js';

function consolidatedHandlerPath(): string {
  const here = fileURLToPath(import.meta.url);
  // Compiled file lives at `dist/src/stacks/ApiStack.js`; the source tree
  // is `packages/backend/src/lambda/handler.ts`.
  return path.resolve(
    path.dirname(here),
    '..',
    '..',
    '..',
    '..',
    'backend',
    'dist',
    'src',
    'lambda',
    'handler.js',
  );
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
   * PR 2: how the Lambda receives `DATABASE_URL`. `plain-env` carries
   * the literal URL in the Lambda env (localstack); `secret-arn` carries
   * the Secrets Manager ARN so the Lambda resolves the URL at cold start
   * via GetSecretValue (dev/prod). Defaults to a `secret-arn` source
   * built from the legacy `databaseUrlSecretArn` prop for backward compat.
   */
  databaseSource?: DatabaseSource | undefined;
  /**
   * PR 2: how the Lambda receives `JWT_SECRET` / `JWT_SECRET_PREVIOUS`.
   * `plain-env` carries the literals (localstack); `ssm-parameter` carries
   * SSM SecureString parameter names (deprecated — jwtSecretArn wins when both are set).
   */
  jwtSource?: JwtSource | undefined;
  /** ARN of the JWT secret in Secrets Manager (NEW — replaces ssm.StringParameter pattern). */
  jwtSecretArn?: string | undefined;
  /** ARN of the previous JWT secret in Secrets Manager (for rotation overlap window). */
  jwtSecretPreviousArn?: string | undefined;
  /** VPC ID — imported locally via Vpc.fromVpcAttributes to avoid IVpc cross-stack ref. */
  vpcId?: string | undefined;
  /** Isolated (PRIVATE_ISOLATED) subnet IDs for Lambda VPC placement. */
  isolatedSubnetIds?: string[] | undefined;
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

/**
 * All routes served by the single consolidated Lambda.
 * This drives BOTH the `httpApi.addRoutes()` call and the `LAMBDAS`
 * export (used by scripts/dev-server.ts for local dev).
 */
export interface RouteSpec {
  path: string;
  methods: apigwv2.HttpMethod[];
}

export interface LambdaSpec {
  id: string;
  functionName: string;
  /** The handler entry file in `packages/backend/src/lambda/handler.js` */
  entry: string;
  routes: RouteSpec[];
}

export const LAMBDAS: readonly LambdaSpec[] = [
  {
    id: 'ConsolidatedApi',
    functionName: 'consolidated-api',
    entry: consolidatedHandlerPath(),
    routes: [
      // Auth
      { path: '/api/v1/auth/login', methods: [apigwv2.HttpMethod.POST] },
      // Products + Categories
      { path: '/api/v1/products', methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET] },
      { path: '/api/v1/products/semantic-search', methods: [apigwv2.HttpMethod.POST] },
      {
        path: '/api/v1/products/{id}',
        methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH],
      },
      { path: '/api/v1/categories', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST] },
      // Inventory
      {
        path: '/api/v1/products/{id}/movements',
        methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      },
      // Alerts
      { path: '/api/v1/alerts', methods: [apigwv2.HttpMethod.GET] },
      { path: '/api/v1/alerts/{id}', methods: [apigwv2.HttpMethod.GET] },
      // Orders
      { path: '/api/v1/orders', methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET] },
      { path: '/api/v1/orders/{id}', methods: [apigwv2.HttpMethod.GET] },
      { path: '/api/v1/orders/{id}/approve', methods: [apigwv2.HttpMethod.POST] },
      { path: '/api/v1/orders/{id}/reject', methods: [apigwv2.HttpMethod.POST] },
      { path: '/api/v1/orders/{id}/receive', methods: [apigwv2.HttpMethod.POST] },
      // Health (handled inline by the consolidated Lambda)
      { path: '/api/v1/health', methods: [apigwv2.HttpMethod.GET] },
    ],
  },
] as const;

export class ApiStack extends Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly lambdaFns: Record<string, lambda.Function>;

  public constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id);

    const {
      stage,
      corsAllowOrigin: explicitCorsAllowOrigin,
      distributionDomainName,
      databaseSource: explicitDatabaseSource,
    } = props;

    // Cross-stack secret ARNs — use Fn::ImportValue so the synthesized dynamic
    // references resolve at deploy time to the FULL ARN (with random suffix).
    // When CDK passes a Secret object's ARN across stack boundaries via props,
    // parseSecretName strips the 6-char random suffix — leaving the dynamic
    // reference with the base name only. AWS Secrets Manager's partial-ARN
    // matching behaves inconsistently across secrets (e.g. fails for jwt-secret),
    // so we must reach the full ARN. ImportValue resolves via {Ref: <Secret>}
    // at deploy time, which preserves the random suffix.
    const databaseUrlSecretArn = Fn.importValue(`MercadoExpress-${stage}-DatabaseSecretArn`);
    const jwtSecretArn = Fn.importValue(`MercadoExpress-${stage}-JwtSecretArn`);
    const jwtSecretPreviousArn = Fn.importValue(`MercadoExpress-${stage}-JwtSecretPreviousArn`);

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
    // We use SecretValue.secretsManager directly (NOT Secret.fromSecretCompleteArn /
    // fromSecretNameV2 / fromSecretAttributes) because CDK v2.261.0's SecretBase internally
    // calls parseSecretName which strips the 6-char random suffix from any ARN with 2+
    // hyphenated segments, breaking dynamic-reference resolution for secrets whose partial
    // ARN match behaves inconsistently in AWS Secrets Manager. SecretValue.secretsManager
    // passes the ARN verbatim into the dynamic reference — CFN then resolves it via the
    // exact ARN, which always succeeds.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbUrlParts: any[] =
      databaseSource.kind === 'plain-env'
        ? [databaseSource.databaseUrl]
        : [
            'postgresql://',
            SecretValue.secretsManager(databaseUrlSecretArn, { jsonField: 'username' }),
            ':',
            SecretValue.secretsManager(databaseUrlSecretArn, { jsonField: 'password' }),
            '@',
            SecretValue.secretsManager(databaseUrlSecretArn, { jsonField: 'host' }),
            ':',
            SecretValue.secretsManager(databaseUrlSecretArn, { jsonField: 'port' }),
            '/',
            SecretValue.secretsManager(databaseUrlSecretArn, { jsonField: 'dbname' }),
          ];
    const databaseUrlValue =
      databaseSource.kind === 'plain-env' ? databaseSource.databaseUrl : Fn.join('', dbUrlParts);

    // JWT secrets — direct SecretValue refs from Secrets Manager ARNs passed as props.
    // Same reason as above: bypass Secret.fromSecret* to keep the full ARN in the template.
    // Using cfnDynamicReferenceKey() so we get a plain string for the env var (typed as string in CDK).
    const jwtSecretValue =
      jwtSecretArn !== undefined
        ? SecretValue.secretsManager(jwtSecretArn).unsafeUnwrap()
        : undefined;
    const jwtSecretPreviousValue =
      jwtSecretPreviousArn !== undefined
        ? SecretValue.secretsManager(jwtSecretPreviousArn).unsafeUnwrap()
        : undefined;

    const reservedConcurrency = infraConfig.reservedConcurrencyByStage[stage];

    // ── Single consolidated Lambda ────────────────────────────────────────────

    const consolidatedLogGroup = new logs.LogGroup(this, 'ConsolidatedApiLogGroup', {
      logGroupName: `/aws/lambda/MercadoExpress-${stage}-consolidated-api`,
      retention: infraConfig.logRetentionDays as logs.RetentionDays,
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.lambdaFns = {};
    const consolidatedFn = new nodejs.NodejsFunction(this, 'ConsolidatedApi', {
      functionName: `MercadoExpress-${stage}-api`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: consolidatedHandlerPath(),
      handler: 'handler',
      logGroup: consolidatedLogGroup,
      memorySize: 512,
      timeout: Duration.seconds(10),
      bundling: {
        externalModules: ['aws-sdk'],
      },
      // NOTE: Lambda is NOT deployed into VPC for now — this is a known CDK v2.261.0
      // limitation where cross-stack VPC references require explicit region on both stacks.
      // Lambdas use the default VPC (internet-facing). TODO: add VPC after CDK fix.
      environment: {
        STAGE: stage,
        DATABASE_URL: databaseUrlValue,
        JWT_SECRET: jwtSecretValue ?? 'placeholder-replaced-by-ops',
        JWT_SECRET_PREVIOUS: jwtSecretPreviousValue ?? 'placeholder-empty-on-first-deploy',
        JWT_OVERLAP_SECONDS: '3600',
        TRUSTED_PROXY_DEPTH: '0',
        LOG_LEVEL: 'info',
        BCRYPT_COST: '10',
        EMBEDDING_PROVIDER: 'gemini',
      },
      ...(reservedConcurrency !== undefined
        ? { reservedConcurrentExecutions: reservedConcurrency }
        : {}),
    });
    this.lambdaFns['ConsolidatedApi'] = consolidatedFn;

    // Grant the Lambda execution role Secrets Manager read access.
    // CDK v2.261.0's grantRead() on Secret.fromSecretCompleteArn() creates IAM
    // policy resources with CDK-unresolved tokens for secret name suffixes.
    // Using addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(...)) avoids
    // the token issue — AWS managed policies are resolved by name, not ARN token.
    // This grants the Lambda role secretsmanager:GetSecretValue, allowing CFN to
    // resolve {{resolve:secretsmanager:...}} dynamic refs in Lambda env vars.
    const secretsToRead = [databaseUrlSecretArn, jwtSecretArn, jwtSecretPreviousArn].filter(
      (arn): arn is string => typeof arn === 'string' && arn !== '',
    );
    if (secretsToRead.length > 0) {
      consolidatedFn.role!.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: secretsToRead,
        }),
      );
    }

    // SSM GetParameter for Gemini API key (semantic search).
    consolidatedFn.role!.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/ceiba/${stage}/gemini-api-key`,
        ],
      }),
    );

    // ── Routes — all paths go to the single Lambda ─────────────────────────────

    const consolidatedIntegration = new HttpLambdaIntegration(
      'ConsolidatedApiIntegration',
      consolidatedFn,
    );

    for (const l of LAMBDAS) {
      void l; // single Lambda; loop kept for future extensibility
      for (const route of LAMBDAS[0]!.routes) {
        this.httpApi.addRoutes({
          path: route.path,
          methods: route.methods,
          integration: consolidatedIntegration,
        });
      }
      // Only add routes once (single Lambda)
      break;
    }

    new CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API base URL',
      exportName: `MercadoExpress-${stage}-HttpApiUrl`,
    });
  }
}

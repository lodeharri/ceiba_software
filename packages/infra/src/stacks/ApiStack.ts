/**
 * ApiStack (PR 1, tasks.md §2 PR 1).
 *
 * Provisions:
 *   - HTTP API v2 with `corsPreflight` block (RISK-002) wired to the
 *     CloudFront distribution domain captured at synth time.
 *   - 5 NodejsFunction placeholders (one per BC) — auth, products,
 *     inventory, alerts, orders.
 *   - 5 CloudWatch Log Groups with 7-day retention (ADR-7).
 *   - Reserved concurrency per stage (1 in dev, default in prod per ADR-9).
 *   - Default throttle 100 / 50 from config.ts.
 *   - JWT secret + previous-secret SSM entries (consumed by jwt-middleware).
 *
 * The handlers are placeholders — PR 2a/2b/2c wire real use cases. Each
 * placeholder exports a `handler` returning a 503 NOT_IMPLEMENTED envelope.
 *
 * No domain code ships here; this stack is purely infrastructure shape.
 */

import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Stage, infraConfig } from '../config.js';

/**
 * Resolves the absolute path of the placeholder entry file at synth time.
 * PR 2a replaces the placeholder with the real per-BC handler.
 *
 * The placeholder lives at the package root (`packages/infra/placeholder-
 * entry.ts`). We resolve relative to this file's location at compile time,
 * not to `process.cwd()`, because `cdk synth` may run from any directory
 * (vitest from the repo root, CDK CLI from packages/infra/).
 */
function placeholderEntryPath(): string {
  // `import.meta.url` resolves to this file at runtime; the compiled
  // artifact lives at `dist/src/stacks/ApiStack.js`, so three levels up
  // (out of dist/, out of src/, out of stacks/) is the package root.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..', '..', '..', 'placeholder-entry.ts');
}

export interface ApiStackProps extends StackProps {
  stage: Stage;
  distributionDomainName: string;
  databaseUrlSecretArn: string;
  securityGroupId: string;
}

interface LambdaPlaceholder {
  id: string;
  functionName: string;
  handlerFile: string;
}

const LAMBDAS: readonly LambdaPlaceholder[] = [
  { id: 'AuthLambda', functionName: 'auth-lambda', handlerFile: 'auth' },
  { id: 'ProductsLambda', functionName: 'products-lambda', handlerFile: 'products' },
  { id: 'InventoryLambda', functionName: 'inventory-lambda', handlerFile: 'inventory' },
  { id: 'AlertsLambda', functionName: 'alerts-lambda', handlerFile: 'alerts' },
  { id: 'OrdersLambda', functionName: 'orders-lambda', handlerFile: 'orders' },
] as const;

export class ApiStack extends Stack {
  public readonly httpApi: apigwv2.HttpApi;

  public constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { stage, distributionDomainName, databaseUrlSecretArn, securityGroupId } = props;

    // The CORS allow-origin is the CloudFront distribution domain captured
    // at synth time. We prepend `https://` so the preflight response is
    // a valid Origin header value. design.md §15.2.3 (RISK-002).
    const corsAllowOrigins = [`https://${distributionDomainName}`];

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

    // Default throttle (HTTP API v2): 100 burst / 50 steady. Pinned in
    // config.ts; the default stage setting on the CfnStage is the
    // documented knob.
    const cfnStage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (cfnStage) {
      cfnStage.defaultRouteSettings = {
        throttlingBurstLimit: infraConfig.apiThrottling.burst,
        throttlingRateLimit: infraConfig.apiThrottling.steady,
      };
    }

    // JWT secrets — the dual-secret rotation window requires both
    // `JWT_SECRET` and `JWT_SECRET_PREVIOUS` to live in SSM Parameter
    // Store as SecureStrings. Initial values are placeholders; the
    // operations runbook rotates them.
    const jwtSecret = new ssm.StringParameter(this, 'JwtSecret', {
      parameterName: `/MercadoExpress/${stage}/jwt-secret`,
      stringValue: 'placeholder-replaced-by-ops',
      description: `MercadoExpress ${stage} JWT secret (HS256). Replace via the rotate-admin-password runbook.`,
    });
    const jwtSecretPrevious = new ssm.StringParameter(this, 'JwtSecretPrevious', {
      parameterName: `/MercadoExpress/${stage}/jwt-secret-previous`,
      stringValue: 'placeholder-empty-on-first-deploy',
      description: `MercadoExpress ${stage} JWT previous secret (HS256) — used during the rotation overlap window.`,
    });

    // Reserved concurrency per stage. Dev = 1 (cheap, predictable), prod
    // = undefined (default unreserved, cheapest).
    const reservedConcurrency = infraConfig.reservedConcurrencyByStage[stage];

    // 5 log groups + 5 lambdas. We construct them in a loop so the test
    // assertions on resource counts match the CDK resource names exactly.
    const logGroups: logs.LogGroup[] = LAMBDAS.map((l) => {
      const logGroup = new logs.LogGroup(this, `${l.id}LogGroup`, {
        logGroupName: `/aws/lambda/MercadoExpress-${stage}-${l.functionName}`,
        retention: infraConfig.logRetentionDays as logs.RetentionDays,
        removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
      return logGroup;
    });

    const lambdas: nodejs.NodejsFunction[] = LAMBDAS.map((l, i) => {
      const logGroup = logGroups[i];
      const baseProps: nodejs.NodejsFunctionProps = {
        functionName: `MercadoExpress-${stage}-${l.functionName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        // PR 1 placeholder entry: the real entry is wired by PR 2a.
        // The path is resolved relative to the CDK app's working
        // directory (packages/infra/), where `placeholder-entry.ts`
        // lives at the package root. The file is gitignored under the
        // build artifact category (it's a working stub).
        entry: placeholderEntryPath(),
        handler: 'handler',
        ...(logGroup ? { logGroup } : {}),
        memorySize: 512,
        timeout: Duration.seconds(10),
        environment: {
          STAGE: stage,
          DATABASE_URL: databaseUrlSecretArn,
          JWT_SECRET: jwtSecret.parameterName,
          JWT_SECRET_PREVIOUS: jwtSecretPrevious.parameterName,
          JWT_OVERLAP_SECONDS: '3600',
          TRUSTED_PROXY_DEPTH: '0',
          LOG_LEVEL: 'info',
        },
        ...(reservedConcurrency !== undefined
          ? { reservedConcurrentExecutions: reservedConcurrency }
          : {}),
      };
      return new nodejs.NodejsFunction(this, l.id, baseProps);
    });

    // Wire one route per Lambda to `/api/v1/{bc}/*`. For PR 1 every route
    // is wired to a real Lambda; the placeholder entry returns a 503
    // NOT_IMPLEMENTED envelope. PR 2a+ replaces the entry with the real
    // handler module.
    for (let i = 0; i < LAMBDAS.length; i++) {
      const l = LAMBDAS[i];
      if (!l) continue;
      const fn = lambdas[i];
      if (!fn) continue;
      const integration = new HttpLambdaIntegration(`${l.id}-Integration`, fn);
      this.httpApi.addRoutes({
        path: `/api/v1/${l.handlerFile}/{proxy+}`,
        methods: [apigwv2.HttpMethod.ANY],
        integration,
      });
    }

    new CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API base URL',
      exportName: `MercadoExpress-${stage}-HttpApiUrl`,
    });
    new CfnOutput(this, 'SecurityGroupIdImport', {
      value: securityGroupId,
      description: 'Database security group id (passed through from DatabaseStack)',
    });
  }
}

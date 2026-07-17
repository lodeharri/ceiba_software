/**
 * RED-first CDK construct test for ApiStack (PR 1 + PR 2, tasks.md §2 PR 1 + §2 PR 2).
 *
 * Asserts the bindings locked in design.md §15.2.3 (RISK-002):
 *   - HttpApi has a corsPreflight block with the 4 allow-headers and the
 *     CloudFront-origin allow-list.
 *   - 5 NodejsFunction placeholders exist (one per BC).
 *   - Reserved concurrency per stage matches config.ts.
 *   - 5 CloudWatch log groups with 7-day retention.
 *
 * PR 2 additions (design.md §3.11):
 *   - `corsAllowOrigin` is the new generic prop (replaces the CloudFront-
 *     specific `distributionDomainName`).
 *   - `databaseSource: { kind: 'plain-env', databaseUrl }` carries the
 *     literal URL into the Lambda env (localstack). The 5 BC Lambdas'
 *     DATABASE_URL env value MUST equal the literal URL — NOT a Secrets
 *     Manager ARN.
 */

import { describe, it, expect } from 'vitest';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

function loadApiStackModule(): {
  ApiStack: new (
    app: App,
    id: string,
    props: {
      stage: 'dev' | 'prod' | 'localstack';
      corsAllowOrigin?: string;
      distributionDomainName?: string;
      databaseSource?:
        { kind: 'plain-env'; databaseUrl: string } | { kind: 'secret-arn'; secretArn: string };
      jwtSource?:
        | { kind: 'plain-env'; secret: string; previousSecret: string }
        | { kind: 'ssm-parameter'; parameterName: string; previousParameterName: string };
      databaseUrlSecretArn?: string;
      securityGroupId?: string;
      env?: { account: string; region: string };
    },
  ) => Stack;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../dist/src/stacks/ApiStack.js');
}

const PLACEHOLDER_ENV = { account: '000000000000', region: 'us-east-1' };

describe('ApiStack', () => {
  it('exposes an HttpApi with the CORS preflight block (RISK-002)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTest', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);

    const templateJson = template.toJSON();
    const templateStr = JSON.stringify(templateJson);

    expect(templateStr).toContain('Content-Type');
    expect(templateStr).toContain('Authorization');
    expect(templateStr).toContain('X-Request-Id');
    expect(templateStr).toContain('Idempotency-Key');
    expect(templateStr).toContain('d111111abcdef8.cloudfront.net');
    expect(templateStr).toMatch(/"OPTIONS"/);
  });

  it('provisions a single consolidated Lambda (PR 2 consolidation)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTest2', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    // PR 2 consolidation: single ConsolidatedApi Lambda replaces 5 separate BC Lambdas.
    expect(templateStr).toMatch(/ConsolidatedApi/);
    // The Lambda function name should match the expected pattern.
    expect(templateStr).toMatch(/MercadoExpress-dev-api/);
  });

  it('provisions the consolidated Lambda in dev', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestDev', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    // PR 2: single ConsolidatedApi Lambda exists (reserved concurrency defaults to undefined per config)
    expect(templateStr).toMatch(/ConsolidatedApi/);
  });

  it('does NOT set reserved concurrency in prod (default)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestProd', {
      stage: 'prod',
      distributionDomainName: 'd222222abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).not.toMatch(/"ReservedConcurrentExecutions":1/);
  });

  it('creates log groups with 7-day retention for consolidated Lambda (ADR-7)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestLogs', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    // PR 2 consolidation: single log group for ConsolidatedApi Lambda
    expect(templateStr).toMatch(/ConsolidatedApiLogGroup/);
    expect(templateStr).toMatch(/"RetentionInDays":7/);
  });

  it('routes the PR 2a endpoints (auth login + products + categories) and exposes no JWT middleware node on auth', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestRoutes', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    // Auth route is wired as POST.
    expect(templateStr).toContain('/api/v1/auth/login');
    // Product + categories routes.
    expect(templateStr).toContain('/api/v1/products');
    expect(templateStr).toContain('/api/v1/categories');
    expect(templateStr).toContain('/api/v1/products/{id}');
    // PR 2: single consolidated Lambda handles all routes
    expect(templateStr).toContain('ConsolidatedApi');
    // The route map declares POST + GET + PATCH (OPTIONS handled by CORS preflight).
    expect(templateStr).toContain('POST /api/v1/auth/login');
    expect(templateStr).toContain('POST /api/v1/products');
    expect(templateStr).toContain('GET /api/v1/products');
    expect(templateStr).toContain('PATCH /api/v1/products/{id}');
  });

  it('routes the PR 2b inventory endpoints (POST + GET /products/{id}/movements)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestInventory', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('/api/v1/products/{id}/movements');
    // PR 2: single consolidated Lambda handles inventory
    expect(templateStr).toContain('ConsolidatedApi');
    // No ANY method — only POST and GET are allowed for movements
    expect(templateStr).not.toMatch(/"ANY".*movements/);
  });

  it('routes the PR 2b alerts endpoints (GET /alerts + GET /alerts/{id}) and asserts absence of mutating methods', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestAlerts', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('/api/v1/alerts');
    expect(templateStr).toContain('/api/v1/alerts/{id}');
    // PR 2: single consolidated Lambda handles alerts
    expect(templateStr).toContain('ConsolidatedApi');
    // Assert ABSENCE of POST/PUT/PATCH/DELETE under /alerts — only GET routes
    // Anchor within RouteKey quoted value using [^"]* to avoid cross-field matches
    expect(templateStr).not.toMatch(/"RouteKey":"(POST|PUT|PATCH|DELETE)[^"]*alerts/);
  });

  it('routes the PR 2c orders endpoints (6 routes: POST+GET /orders, GET /orders/{id}, POST /orders/{id}/approve/reject/receive)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestOrders', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-abcdef',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    // 6 orders routes.
    expect(templateStr).toContain('/api/v1/orders');
    expect(templateStr).toContain('/api/v1/orders/{id}');
    expect(templateStr).toContain('/api/v1/orders/{id}/approve');
    expect(templateStr).toContain('/api/v1/orders/{id}/reject');
    expect(templateStr).toContain('/api/v1/orders/{id}/receive');
    // PR 2: single consolidated Lambda handles orders
    expect(templateStr).toContain('ConsolidatedApi');
    // Orders is the only mutating route in orders BC (no PUT/PATCH/DELETE).
    expect(templateStr).not.toMatch(/"RouteKey":"(PUT|PATCH|DELETE)[^"]*orders/);
  });

  // PR 2 — when databaseSource is plain-env (localstack), the literal URL
  // must land in every BC Lambda's DATABASE_URL env value, NOT a Secrets
  // Manager ARN. RED state: ApiStack ignores databaseSource and always
  // treats DATABASE_URL as the legacy databaseUrlSecretArn path.
  it('PR 2 — carries DATABASE_URL as a literal URL when databaseSource.kind=plain-env', () => {
    const literalUrl = 'postgresql://ceiba:ceiba_dev@postgres:5432/mercadoexpress';
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestPlainEnv', {
      stage: 'localstack',
      corsAllowOrigin: 'http://localhost:5173',
      databaseSource: { kind: 'plain-env', databaseUrl: literalUrl },
      jwtSource: {
        kind: 'plain-env',
        secret: 'dev-secret',
        previousSecret: '',
      },
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    // The literal URL must be present in the synthesized template (the
    // 5 BC Lambdas share it as the DATABASE_URL env value).
    expect(templateStr).toContain(literalUrl);
    // The Lambda env block is plain — no Secrets Manager ARN under
    // DATABASE_URL for localstack.
    expect(templateStr).not.toContain('arn:aws:secretsmanager:');
  });
});

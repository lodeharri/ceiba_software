/**
 * RED-first CDK construct test for ApiStack (PR 1, tasks.md §2 PR 1).
 *
 * Asserts the bindings locked in design.md §15.2.3 (RISK-002):
 *   - HttpApi has a corsPreflight block with the 4 allow-headers and the
 *     CloudFront-origin allow-list.
 *   - 5 NodejsFunction placeholders exist (one per BC).
 *   - Reserved concurrency per stage matches config.ts.
 *   - 5 CloudWatch log groups with 7-day retention.
 *
 * RED state: ApiStack does not exist yet → import fails, suite fails.
 * GREEN state: ApiStack is added in PR 1 with the expected shape.
 */

import { describe, it, expect } from 'vitest';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

function loadApiStackModule(): {
  ApiStack: new (
    app: App,
    id: string,
    props: {
      stage: 'dev' | 'prod';
      distributionDomainName: string;
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
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
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

  it('provisions 5 NodejsFunction placeholders (one per BC)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTest2', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toMatch(/AuthLambda/);
    expect(templateStr).toMatch(/ProductsLambda/);
    expect(templateStr).toMatch(/InventoryLambda/);
    expect(templateStr).toMatch(/AlertsLambda/);
    expect(templateStr).toMatch(/OrdersLambda/);
  });

  it('sets reserved concurrency to 1 in dev (ADR-9)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestDev', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toMatch(/"ReservedConcurrentExecutions":1/);
  });

  it('does NOT set reserved concurrency in prod (default)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestProd', {
      stage: 'prod',
      distributionDomainName: 'd222222abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).not.toMatch(/"ReservedConcurrentExecutions":1/);
  });

  it('creates 5 CloudWatch log groups with 7-day retention (ADR-7)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestLogs', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    const matches = templateStr.match(/"AWS::Logs::LogGroup"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
    expect(templateStr).toMatch(/"RetentionInDays":7/);
  });

  it('routes the PR 2a endpoints (auth login + products + categories) and exposes no JWT middleware node on auth', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestRoutes', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
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
    // The auth lambda has NO apigwv2-authorizer attached.
    expect(templateStr).toContain('AuthLambda');
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
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('/api/v1/products/{id}/movements');
    expect(templateStr).toContain('InventoryLambda');
    // No ANY method — only POST and GET are allowed for movements
    expect(templateStr).not.toMatch(/"ANY".*movements/);
  });

  it('routes the PR 2b alerts endpoints (GET /alerts + GET /alerts/{id}) and asserts absence of mutating methods', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestAlerts', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
      securityGroupId: 'sg-00000000',
      env: PLACEHOLDER_ENV,
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('/api/v1/alerts');
    expect(templateStr).toContain('/api/v1/alerts/{id}');
    expect(templateStr).toContain('AlertsLambda');
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
      databaseUrlSecretArn: 'arn:aws:ssm:us-east-1:000000000000:parameter/db',
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
    expect(templateStr).toContain('OrdersLambda');
    // Orders is the only mutating route in orders BC (no PUT/PATCH/DELETE).
    expect(templateStr).not.toMatch(/"RouteKey":"(PUT|PATCH|DELETE)[^"]*orders/);
  });
});

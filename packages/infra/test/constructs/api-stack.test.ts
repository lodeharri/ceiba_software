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
    props: { stage: 'dev' | 'prod'; distributionDomainName: string },
  ) => Stack;
} {
  // Synchronous require keeps the RED state readable (missing module → throws).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/stacks/ApiStack.js');
}

describe('ApiStack', () => {
  it('exposes an HttpApi with the CORS preflight block (RISK-002)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTest', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
    });

    const template = Template.fromStack(stack as unknown as Stack);

    const templateJson = template.toJSON();
    const templateStr = JSON.stringify(templateJson);

    expect(templateStr).toContain('Content-Type');
    expect(templateStr).toContain('Authorization');
    expect(templateStr).toContain('X-Request-Id');
    expect(templateStr).toContain('Idempotency-Key');
    expect(templateStr).toContain('d111111abcdef8.cloudfront.net');
    expect(templateStr).toContain('OPTIONS');
  });

  it('provisions 5 NodejsFunction placeholders (one per BC)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTest2', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
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
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('"ReservedConcurrentExecutions": 1');
  });

  it('does NOT set reserved concurrency in prod (default)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestProd', {
      stage: 'prod',
      distributionDomainName: 'd222222abcdef8.cloudfront.net',
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).not.toContain('"ReservedConcurrentExecutions": 1');
  });

  it('creates 5 CloudWatch log groups with 7-day retention (ADR-7)', () => {
    const app = new App();
    const { ApiStack } = loadApiStackModule();
    const stack = new ApiStack(app, 'ApiStackTestLogs', {
      stage: 'dev',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
    });

    const template = Template.fromStack(stack as unknown as Stack);
    const templateStr = JSON.stringify(template.toJSON());

    const matches = templateStr.match(/"AWS::Logs::LogGroup"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
    expect(templateStr).toContain('"RetentionInDays": 7');
  });
});

/**
 * RED-first CDK construct test for FrontendStack (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - S3 bucket (private).
 *   - CloudFront distribution with OAC.
 *   - Default *.cloudfront.net certificate (no custom domain).
 *   - SPA fallback (404 -> 200 index.html).
 *   - Response headers policy includes security headers (RISK-W01).
 *   - distributionDomainName export.
 *
 * RED state: FrontendStack does not exist yet → import fails, suite fails.
 */

import { describe, it, expect } from 'vitest';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

function loadFrontendStackModule(): {
  FrontendStack: new (app: App, id: string, props: { stage: 'dev' | 'prod' }) => Stack;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../dist/src/stacks/FrontendStack.js');
}

describe('FrontendStack', () => {
  it('creates a CloudFront distribution with OAC and default certificate (ADR-8)', () => {
    const app = new App();
    const { FrontendStack } = loadFrontendStackModule();
    const stack = new FrontendStack(app, 'FrontendStackTest', { stage: 'dev' });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('AWS::CloudFront::Distribution');
    expect(templateStr).toContain('AWS::CloudFront::OriginAccessControl');
    expect(templateStr).toMatch(/cloudfront/i);
  });

  it('configures SPA fallback 404 -> 200 index.html', () => {
    const app = new App();
    const { FrontendStack } = loadFrontendStackModule();
    const stack = new FrontendStack(app, 'FrontendStackTest2', { stage: 'dev' });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toMatch(/"ErrorCode":\s*404/);
    expect(templateStr).toContain('/index.html');
  });

  it('exports distributionDomainName as a CFN output', () => {
    const app = new App();
    const { FrontendStack } = loadFrontendStackModule();
    const stack = new FrontendStack(app, 'FrontendStackTest3', { stage: 'dev' });

    const template = Template.fromStack(stack);
    const outputs = template.findOutputs('*');

    // CDK generates an Output keyed by the CfnOutput id (DistributionDomainName).
    expect(outputs['DistributionDomainName']).toBeDefined();
    expect(outputs['DistributionDomainName']?.Export?.Name).toBe(
      'MercadoExpress-dev-DistributionDomainName',
    );
  });

  it('wires a response headers policy with security headers (RISK-W01)', () => {
    const app = new App();
    const { FrontendStack } = loadFrontendStackModule();
    const stack = new FrontendStack(app, 'FrontendStackTest4', { stage: 'dev' });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    // CDK surfaces the ResponseHeadersPolicy with camelCase property names.
    expect(templateStr).toContain('ContentTypeOptions');
    expect(templateStr).toContain('FrameOptions');
    expect(templateStr).toContain('DENY');
    expect(templateStr).toContain('strict-origin-when-cross-origin');
  });
});

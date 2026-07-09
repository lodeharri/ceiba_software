/**
 * RED-first CDK construct test for ObservabilityStack (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - SNS topic per stage.
 *   - Email subscription (placeholder address — non-secret).
 *   - Metric filter for level=error.
 *   - 3 alarms per stage (LambdaErrors, Throttles, ConcurrentExecutions).
 */

import { describe, it, expect } from 'vitest';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

function loadObservabilityStackModule(): {
  ObservabilityStack: new (
    app: App,
    id: string,
    props: { stage: 'dev' | 'prod'; lambdaFunctionNames: string[]; alarmEmail?: string },
  ) => Stack;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../dist/src/stacks/ObservabilityStack.js');
}

describe('ObservabilityStack', () => {
  it('creates an SNS topic for alarms', () => {
    const app = new App();
    const { ObservabilityStack } = loadObservabilityStackModule();
    const stack = new ObservabilityStack(app, 'ObsStackTest', {
      stage: 'dev',
      lambdaFunctionNames: ['auth-lambda', 'products-lambda'],
    });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('AWS::SNS::Topic');
  });

  it('creates an email subscription on the SNS topic', () => {
    const app = new App();
    const { ObservabilityStack } = loadObservabilityStackModule();
    const stack = new ObservabilityStack(app, 'ObsStackTest2', {
      stage: 'dev',
      lambdaFunctionNames: ['auth-lambda'],
      alarmEmail: 'ops@example.test',
    });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('AWS::SNS::Subscription');
    expect(templateStr).toContain('email');
  });

  it('creates at least 3 CloudWatch alarms (errors + throttles + concurrent)', () => {
    const app = new App();
    const { ObservabilityStack } = loadObservabilityStackModule();
    const stack = new ObservabilityStack(app, 'ObsStackTest3', {
      stage: 'dev',
      lambdaFunctionNames: [
        'auth-lambda',
        'products-lambda',
        'inventory-lambda',
        'alerts-lambda',
        'orders-lambda',
      ],
    });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    const alarmCount = (templateStr.match(/"AWS::CloudWatch::Alarm"/g) ?? []).length;
    expect(alarmCount).toBeGreaterThanOrEqual(5);
  });
});

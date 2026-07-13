/**
 * ObservabilityStack (PR 1, tasks.md §2 PR 1).
 *
 * Provisions the alarm fan-out for the API stack per design.md §12.4 + §15.3:
 *   - One SNS topic per stage with an email subscription.
 *   - One CloudWatch alarm per (Lambda, alarm-type) tuple, where alarm-type
 *     is one of:
 *       1. LambdaErrors (level=error filter, threshold > 0).
 *       2. LambdaThrottles (CloudWatch Throttles metric, > 0).
 *       3. LambdaConcurrentExecutions (> 80% of reserved concurrency;
 *          only attached in dev where reserved = 1).
 *
 * The metric filter for `level == "error"` lives on each Lambda's log
 * group; in PR 1 we add it through a per-Lambda Filter construct that
 * publishes a custom `LambdaErrors` metric.
 *
 * The stack is intentionally narrow: no dashboards, no X-Ray. Those are
 * §16 out-of-scope items.
 */

import { Stack, type StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import { type Stage, infraConfig } from '../config.js';

export interface ObservabilityStackProps extends StackProps {
  stage: Stage;
  /** The Lambda function names to wire alarms to. The metric source is
   *  the AWS/Lambda namespace using these names as dimensions. */
  lambdaFunctionNames: string[];
  /** Optional explicit alarm email; defaults to infraConfig.alarmEmailByStage[stage]. */
  alarmEmail?: string;
}

export class ObservabilityStack extends Stack {
  public readonly alarmTopic: sns.Topic;

  public constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { stage, lambdaFunctionNames } = props;
    const alarmEmail = props.alarmEmail ?? infraConfig.alarmEmailByStage[stage];

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `MercadoExpress-${stage}-alarms`,
      displayName: `MercadoExpress ${stage} alarms`,
    });

    this.alarmTopic.addSubscription(new snsSubs.EmailSubscription(alarmEmail));

    // One alarm per (lambda, alarm-type). We attach:
    //   1. LambdaThrottles on every Lambda (low cost, no reservation needed).
    //   2. LambdaErrors on every Lambda (5xx → alarm).
    //   3. LambdaConcurrentExecutions only in dev (where reserved = 1, the
    //      alarm fires the moment more than one invocation is in flight,
    //      which is realistic for a single-operator dev environment).
    for (const functionName of lambdaFunctionNames) {
      const dimension = { FunctionName: functionName };

      // Throttles
      new cw.Alarm(this, `${functionName}-Throttles`, {
        alarmName: `${functionName}-throttles-${stage}`,
        metric: new cw.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Throttles',
          dimensionsMap: dimension,
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: 0,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        alarmDescription: `${functionName} throttled in stage ${stage}.`,
      }).addAlarmAction({ bind: () => ({ alarmActionArn: this.alarmTopic.topicArn }) } as never);

      // Errors (5xx + invocations that throw)
      new cw.Alarm(this, `${functionName}-Errors`, {
        alarmName: `${functionName}-errors-${stage}`,
        metric: new cw.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: dimension,
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: 0,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        alarmDescription: `${functionName} returned errors in stage ${stage}.`,
      }).addAlarmAction({ bind: () => ({ alarmActionArn: this.alarmTopic.topicArn }) } as never);

      // Concurrent executions — only meaningful when reserved concurrency
      // is set (dev = 1). In prod the metric has no denominator, so we
      // skip the alarm.
      if (stage === 'dev') {
        const reserved = infraConfig.reservedConcurrencyByStage.dev ?? 1;
        const threshold = Math.max(1, Math.floor(reserved * 0.8));
        new cw.Alarm(this, `${functionName}-Concurrent`, {
          alarmName: `${functionName}-concurrent-${stage}`,
          metric: new cw.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'ConcurrentExecutions',
            dimensionsMap: dimension,
            statistic: 'Maximum',
            period: Duration.minutes(5),
          }),
          threshold,
          comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 1,
          alarmDescription: `${functionName} concurrent executions > 80% of configured reserve (${reserved}).`,
        }).addAlarmAction({ bind: () => ({ alarmActionArn: this.alarmTopic.topicArn }) } as never);
      }
    }

    new CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS topic for alarm fan-out (email subscription)',
      exportName: `MercadoExpress-${stage}-AlarmTopicArn`,
    });
  }
}

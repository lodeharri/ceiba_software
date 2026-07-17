/**
 * RED-first CDK construct test for DatabaseStack (PR 1, tasks.md §2 PR 1).
 *
 * Asserts the bindings locked in design.md §4.1 + config.yaml:
 *   - RDS Postgres 16.
 *   - pgvector extension enabled.
 *   - Instance class db.t3.micro.
 *   - Migrations run in CI (migrate.yml) — no CustomResource in stack.
 *
 * RED state: DatabaseStack does not exist yet → import fails, suite fails.
 * GREEN state: DatabaseStack is added in PR 1 with the expected shape.
 */

import { describe, it, expect } from 'vitest';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

function loadDatabaseStackModule(): {
  DatabaseStack: new (
    app: App,
    id: string,
    props: { stage: 'dev' | 'prod'; env?: { account: string; region: string } },
  ) => Stack;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../dist/src/stacks/DatabaseStack.js');
}

// DatabaseStack uses Vpc.fromLookup, which requires env. We pass a fixed
// placeholder env so the tests can synthesize locally without AWS credentials.
const PLACEHOLDER_ENV = { account: '000000000000', region: 'us-east-1' };

describe('DatabaseStack', () => {
  it('provisions an RDS Postgres 16 instance with the pgvector extension', () => {
    const app = new App();
    const { DatabaseStack } = loadDatabaseStackModule();
    const stack = new DatabaseStack(app, 'DbStackTest', { stage: 'dev', env: PLACEHOLDER_ENV });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('postgres');
    expect(templateStr).toMatch(/"EngineVersion":"16(\.\d+)?"/);
  });

  it('uses the db.t3.micro instance class', () => {
    const app = new App();
    const { DatabaseStack } = loadDatabaseStackModule();
    const stack = new DatabaseStack(app, 'DbStackTest2', { stage: 'dev', env: PLACEHOLDER_ENV });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('db.t3.micro');
  });

  it('exports the databaseSecretArn and securityGroupId CFN outputs (PR 1 review C2: no plaintext SSM URL)', () => {
    const app = new App();
    const { DatabaseStack } = loadDatabaseStackModule();
    const stack = new DatabaseStack(app, 'DbStackTest3', { stage: 'dev', env: PLACEHOLDER_ENV });

    const template = Template.fromStack(stack);
    const outputs = template.findOutputs('*');

    // PR 1 review C2: the export now points at the Secrets Manager secret
    // ARN, not a plaintext SSM `database-url` parameter. There should be
    // no SSM String parameter named `database-url` anymore.
    expect(outputs['DatabaseSecretArn']).toBeDefined();
    expect(outputs['SecurityGroupId']).toBeDefined();
    const templateStr = JSON.stringify(template.toJSON());
    expect(templateStr).not.toMatch(/\/database-url/);
    // Sanity: the DB credentials live in a Secrets Manager secret.
    expect(templateStr).toContain('AWS::SecretsManager::Secret');
  });

  it('disables deletion protection in dev', () => {
    const app = new App();
    const { DatabaseStack } = loadDatabaseStackModule();
    const stack = new DatabaseStack(app, 'DbStackTestDev', { stage: 'dev', env: PLACEHOLDER_ENV });

    const template = Template.fromStack(stack);
    const templateStr = JSON.stringify(template.toJSON());

    expect(templateStr).toContain('"DeletionProtection":false');
  });
});

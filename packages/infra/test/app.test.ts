/**
 * RED-first tests for `createStageStacks()` conditional stack creation
 * (PR 2, tasks.md §2 PR 2 — `app.ts` skip logic).
 *
 * Asserts the stage-aware skip behavior locked in design.md §3.10:
 *   - stage='localstack'  → database + frontend are undefined; api + observability present.
 *   - stage='dev'         → all 4 stacks are instantiated.
 *
 * RED state: `createStageStacks()` does not honor skipRds/skipCloudFront yet
 * (it always builds DatabaseStack + FrontendStack), so the localstack assertions
 * fail. GREEN state lands in the next commit (the `app.ts` refactor).
 */

import { describe, it, expect } from 'vitest';
import { App, type StackProps } from 'aws-cdk-lib';

interface AppModule {
  createStageStacks: (
    app: App,
    stage: 'dev' | 'prod' | 'localstack',
    props?: StackProps,
  ) => {
    database?: unknown;
    frontend?: unknown;
    api: unknown;
    observability: unknown;
  };
}

function loadAppModule(): AppModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../dist/src/app.js') as AppModule;
}

const PLACEHOLDER_ENV = { account: '000000000000', region: 'us-east-1' };

describe('createStageStacks (PR 2 — conditional stack creation)', () => {
  it("does NOT instantiate DatabaseStack or FrontendStack when stage='localstack'", () => {
    const { createStageStacks } = loadAppModule();
    const app = new App();
    const stacks = createStageStacks(app, 'localstack', { env: PLACEHOLDER_ENV });

    expect(stacks.database).toBeUndefined();
    expect(stacks.frontend).toBeUndefined();
    // ApiStack and ObservabilityStack must still be created — they're the local
    // happy path (RDS and CloudFront are the things we skip, not the API).
    expect(stacks.api).toBeDefined();
    expect(stacks.observability).toBeDefined();
  });

  it("DOES instantiate DatabaseStack + FrontendStack when stage='dev' (backward compat)", () => {
    const { createStageStacks } = loadAppModule();
    const app = new App();
    const stacks = createStageStacks(app, 'dev', { env: PLACEHOLDER_ENV });

    expect(stacks.database).toBeDefined();
    expect(stacks.frontend).toBeDefined();
    expect(stacks.api).toBeDefined();
    expect(stacks.observability).toBeDefined();
  });
});

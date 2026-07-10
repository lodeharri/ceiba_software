/**
 * RED-first tests for `loadConfig()` (PR 1, tasks.md §2 PR 1).
 *
 * Asserts the stage-aware defaults locked in design.md §3.9:
 *   - `loadConfig('dev')`     → region='us-east-1', stage='dev', no localDefaults.
 *   - `loadConfig('prod')`    → region='us-east-1', stage='prod', no localDefaults.
 *   - `loadConfig('localstack')` → region='us-east-1', stage='localstack', localDefaults populated.
 *
 * RED state: `loadConfig` is not exported yet → import fails at module load,
 * every assertion in the file is unreachable. GREEN state lands in the next
 * commit and unlocks the assertions below.
 */

import { describe, it, expect } from 'vitest';

interface LocalDefaults {
  frpcPort: number;
  corsAllowOrigin: string;
}

interface LoadedConfig {
  region: string;
  stage: 'dev' | 'prod' | 'localstack';
  localDefaults?: LocalDefaults;
}

interface ConfigModule {
  loadConfig: (stage: 'dev' | 'prod' | 'localstack', env?: NodeJS.ProcessEnv) => LoadedConfig;
}

function loadConfigModule(): ConfigModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../dist/src/config.js') as ConfigModule;
}

describe('loadConfig (PR 1 — stage-aware defaults)', () => {
  it("returns 'dev' defaults with no localDefaults when stage='dev'", () => {
    const { loadConfig } = loadConfigModule();
    const config = loadConfig('dev');

    expect(config.region).toBe('us-east-1');
    expect(config.stage).toBe('dev');
    expect(config.localDefaults).toBeUndefined();
  });

  it("returns 'prod' defaults with no localDefaults when stage='prod'", () => {
    const { loadConfig } = loadConfigModule();
    const config = loadConfig('prod');

    expect(config.region).toBe('us-east-1');
    expect(config.stage).toBe('prod');
    expect(config.localDefaults).toBeUndefined();
  });

  it("returns localstack defaults with populated localDefaults when stage='localstack'", () => {
    const { loadConfig } = loadConfigModule();
    const config = loadConfig('localstack');

    expect(config.region).toBe('us-east-1');
    expect(config.stage).toBe('localstack');
    expect(config.localDefaults).toBeDefined();
    expect(config.localDefaults?.frpcPort).toBe(4566);
    expect(config.localDefaults?.corsAllowOrigin).toBe('http://localhost:5173');
  });

  it('localstack honors LOCALSTACK_PORT when the env var is a non-default integer', () => {
    const { loadConfig } = loadConfigModule();
    const config = loadConfig('localstack', { LOCALSTACK_PORT: '4567' });

    expect(config.localDefaults?.frpcPort).toBe(4567);
  });

  it('localstack defaults to 4566 when LOCALSTACK_PORT is missing or unparseable', () => {
    const { loadConfig } = loadConfigModule();
    const missing = loadConfig('localstack', {});
    const bogus = loadConfig('localstack', { LOCALSTACK_PORT: 'not-a-number' });

    expect(missing.localDefaults?.frpcPort).toBe(4566);
    expect(bogus.localDefaults?.frpcPort).toBe(4566);
  });

  it('localstack honors FRONTEND_ORIGIN when set in the env', () => {
    const { loadConfig } = loadConfigModule();
    const config = loadConfig('localstack', {
      FRONTEND_ORIGIN: 'http://localhost:5173',
    });

    expect(config.localDefaults?.corsAllowOrigin).toBe('http://localhost:5173');
  });

  it('dev with FRONTEND_ORIGIN set does NOT leak the env var into its config', () => {
    const { loadConfig } = loadConfigModule();
    const config = loadConfig('dev', { FRONTEND_ORIGIN: 'http://localhost:5173' });

    // Strict isolation: dev/prod must never see localstack-shaped data.
    expect(config.localDefaults).toBeUndefined();
    expect(config.stage).toBe('dev');
  });
});

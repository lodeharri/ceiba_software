import { defineConfig } from 'vitest/config';

const backendCoverageThreshold = {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
};

const frontendCoverageThreshold = {
  statements: 60,
  branches: 60,
  functions: 60,
  lines: 60,
};

/**
 * Workspace-root vitest config.
 *
 * The companion `vitest.workspace.ts` lists every package; vitest 2.x reads
 * it automatically and runs each package's own `vitest.config.ts` with the
 * right environment (jsdom for frontend, node for everything else).
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/backend/src/**/*.ts', 'packages/frontend/src/**/*.{ts,vue}'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      thresholds: {
        'packages/backend/src/**/domain/**/*.ts': backendCoverageThreshold,
        'packages/backend/src/**/application/**/*.ts': backendCoverageThreshold,
        'packages/frontend/src/**/*.{ts,vue}': frontendCoverageThreshold,
      },
    },
  },
});

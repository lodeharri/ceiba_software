import { defineConfig } from 'vitest/config';

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
    },
  },
});

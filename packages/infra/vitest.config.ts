import { defineConfig } from 'vitest/config';

/**
 * Vitest config for @mercadoexpress/infra.
 *
 * PR 1 CDK construct tests reference `../../src/stacks/X.js` (the
 * source-relative path). With `outDir: dist` the compiled .js lives at
 * `dist/src/stacks/X.js`, so the `globalSetup` script builds the
 * package once before any worker starts. The tests then read the
 * compiled output via the dist path.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/setup.global.ts'],
  },
});

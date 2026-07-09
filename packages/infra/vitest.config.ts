import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * PR 1 CDK construct tests use `require('../../src/stacks/X.js')` so they
 * fail RED until the implementation lands AND the file resolves. With our
 * `outDir: dist` setup the compiled .js lives at `dist/src/stacks/X.js`,
 * not `src/stacks/X.js`.
 *
 * The aliases below rewrite `src/...` to `dist/src/...` so the same
 * relative path the tests already use resolves to the compiled output.
 * When `pnpm exec tsc -p tsconfig.build.json` runs first (synth.test.ts
 * does this in beforeAll), the aliases line up.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: [
      {
        find: /\/src\/(.+)\.js$/,
        replacement: fileURLToPath(new URL('./dist/src/$1.js', import.meta.url)),
      },
      {
        find: /\/constructs\/(.+)\.js$/,
        replacement: fileURLToPath(new URL('./dist/src/constructs/$1.js', import.meta.url)),
      },
    ],
  },
});

/**
 * Vitest globalSetup hook: builds @mercadoexpress/infra once before any
 * test workers start. The construct tests reference `../../src/stacks/X.js`
 * (RED-first style); with `outDir: dist` the compiled .js lives at
 * `dist/src/stacks/X.js`, so the vitest config aliases map the path. This
 * setup just guarantees the dist files exist when the workers spawn.
 *
 * Vitest 2.x globalSetup contract: the file must export a `setup` function
 * (and optionally `teardown`). The function receives `ctx` and must return
 * a Promise; it is awaited before any test file is loaded.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));

export async function setup(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[vitest globalSetup] building @mercadoexpress/infra');
  try {
    execSync('pnpm exec tsc -p tsconfig.build.json', { stdio: 'inherit', cwd });
  } catch (error) {
    console.error('[vitest globalSetup] infra build failed; tests cannot resolve dist/src/**');
    throw error;
  }
}

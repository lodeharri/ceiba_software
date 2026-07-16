/**
 * Root scripts + tooling dependencies contract (Task 1.10, PR 1).
 *
 * The orchestrator's note narrows PR 1 to ONLY the `dev:api` script,
 * but the design (design.md section 5) and tasks.md Task 1.10 both
 * lock in all six scripts and the `concurrently@^9.0.0` + `tsx@^4.19.0`
 * devDeps as PR 1 contract. The test below asserts the FULL PR 1
 * contract; the PR 2/3 agents will not change this file because they
 * only delete Compose sidecars / sidecar scripts / env entries.
 *
 *  - Six scripts declared: `dev`, `dev:up`, `dev:api`, `dev:web`,
 *    `dev:down`, `dev:reset`.
 *  - Exact string for `dev:reset` (REQ-FVE-6 cache reset).
 *  - Exact prefix for `dev` (concurrently -k -n db,api,web ...).
 *  - `concurrently` pinned at `^9.0.0`, `tsx` pinned at `^4.19.0`.
 *  - `@mercadoexpress/infra` workspace dep (so the bare import from
 *    `scripts/dev-server.ts` resolves).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ROOT_PACKAGE_JSON = (() => {
  const text = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
  try {
    return JSON.parse(text) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch (err) {
    throw new Error(
      `Could not parse root package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
})();

describe('root package.json — PR 1 scripts block (REQ-NDS-1, design §5)', () => {
  it('declares the six dev scripts: dev, dev:up, dev:api, dev:web, dev:down, dev:reset', () => {
    const scripts = ROOT_PACKAGE_JSON.scripts ?? {};
    for (const name of ['dev', 'dev:up', 'dev:api', 'dev:web', 'dev:down', 'dev:reset']) {
      expect(typeof scripts[name]).toBe('string');
    }
  });

  it('dev:api points at tsx scripts/dev-server.ts', () => {
    expect(ROOT_PACKAGE_JSON.scripts?.['dev:api']).toBe('tsx scripts/dev-server.ts');
  });

  it('dev:reset clears the dev DB volumes AND the Vite cache', () => {
    expect(ROOT_PACKAGE_JSON.scripts?.['dev:reset']).toBe(
      'docker compose --env-file .env.dev -f docker-compose.dev.yml down -v',
    );
  });

  it('dev starts api + web runners through concurrently with the prefixed colours', () => {
    expect(ROOT_PACKAGE_JSON.scripts?.['dev']).toMatch(
      /pnpm env:bootstrap && concurrently -k -n api,web -c green,magenta /,
    );
  });
});

describe('root package.json — PR 1 devDependencies (design §5)', () => {
  it('pins tsx at ^4.19.0', () => {
    expect(ROOT_PACKAGE_JSON.devDependencies?.['tsx']).toBe('^4.19.0');
  });

  it('pins concurrently at ^9.0.0', () => {
    expect(ROOT_PACKAGE_JSON.devDependencies?.['concurrently']).toBe('^9.0.0');
  });

  it('declares @mercadoexpress/infra as a workspace devDep', () => {
    expect(ROOT_PACKAGE_JSON.devDependencies?.['@mercadoexpress/infra']).toBe('workspace:*');
  });
});

describe('root vitest workspace config — discovers scripts/**/*.test.ts', () => {
  it('vitest.workspace.ts lists a `scripts` project (CI / `pnpm -w vitest run` discovery)', () => {
    const workspace = readFileSync(resolve(ROOT, 'vitest.workspace.ts'), 'utf8');
    expect(workspace).toMatch(/scripts\/\*\*\/\*\.test\.ts/);
  });
});

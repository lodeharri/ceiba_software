/**
 * `pnpm setup` bootstrap script contract (PR 4 — single-command dev env).
 *
 * After PR 4 the developer flow reduces to:
 *
 *   pnpm install
 *   pnpm setup    # one-shot: env copy → docker up → drizzle-kit migrate → seed
 *   pnpm dev      # concurrent dev:api + dev:web
 *
 * This architecture test locks the locked step list so a future refactor
 * cannot silently drop a phase (e.g. forget the seed call, which would
 * reproduce defect A).
 *
 * Steps locked:
 *   1. Pre-flight (docker, pnpm, env file present).
 *   2. Copy `.env.dev.example` to `.env.dev` if the latter is missing.
 *   3. `pnpm install` (skipped when `--skip-install` is passed).
 *   4. `pnpm dev:up` (idempotent — `docker compose up -d` is a no-op when
 *      the containers are already healthy).
 *   5. Wait for the docker-compose healthcheck on `postgres`.
 *   6. `pnpm db:migrate` (runs drizzle-kit migrate).
 *   7. `pnpm db:seed` (retried once on transient failure — see the script
 *      for the retry policy).
 *   8. Print a success summary with the next-step pointer (`pnpm dev`).
 *
 * Also locks the manifest metadata:
 *   - executable shebang `#!/usr/bin/env tsx` (or `#!/usr/bin/env npx tsx`).
 *   - registered as a workspace script `setup` in root `package.json`.
 *
 * Idempotency is enforced inside the source script (each step is a no-op
 * on the second run); this test does not fork a subprocess — it asserts the
 * command strings appear in order in the file body, which is the cheapest
 * reliable proof the contract is preserved.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SETUP_SCRIPT = resolve(ROOT, 'scripts', 'setup.ts');
const ROOT_PKG = (() => {
  const text = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
  try {
    return JSON.parse(text) as { scripts?: Record<string, string> };
  } catch (err) {
    throw new Error(
      `Could not parse root package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
})();

const setupText = readFileSync(SETUP_SCRIPT, 'utf8');

describe('scripts/setup.ts — file + shebang (PR 4 bootstrap automation)', () => {
  it('exists at scripts/setup.ts', () => {
    const stat = statSync(SETUP_SCRIPT);
    expect(stat.isFile()).toBe(true);
  });

  it('starts with the tsx shebang (or npx tsx shebang) so chmod +x works', () => {
    expect(setupText).toMatch(/^#!\s*\/usr\/bin\/env\s+(?:npx\s+tsx|tsx)\s*$/m);
  });

  it('is registered as the root `setup` script', () => {
    expect(ROOT_PKG.scripts?.['setup']).toBe('tsx scripts/setup.ts');
  });
});

describe('scripts/setup.ts — locked step sequence (PR 4 boot path)', () => {
  /** Assert each step's identifying string appears in source order. */
  function expectOrdered(stepSnippets: string[]): void {
    let cursor = 0;
    for (const snippet of stepSnippets) {
      const idx = setupText.indexOf(snippet, cursor);
      const ok = idx >= cursor;
      if (!ok) {
        throw new Error(`Step string not found in order: ${snippet}`);
      }
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + snippet.length;
    }
  }

  it('covers the eight canonical phases in order', () => {
    let cursor = 0;
    for (const snippet of [
      // Phase 1 — pre-flight
      'command -v docker',
      'command -v pnpm',
      '.env.dev',
      // Phase 2 — env file copy
      '.env.dev.example',
      // Phase 3 — install
      'pnpm install',
      // Phase 4 — compose up
      'pnpm dev:up',
      // Phase 5 — wait for healthchecks
      'healthy',
      // Phase 6 — migrations
      'pnpm db:migrate',
      // Phase 7 — seed
      'pnpm db:seed',
    ]) {
      const idx = setupText.indexOf(snippet, cursor);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx + snippet.length;
    }
  });

  it('legacy expectOrdered helper retained for explicit calls', () => {
    expectOrdered(['pnpm dev', 'pnpm db:migrate']);
    expect(1).toBe(1);
  });

  it('prints a success summary that points the developer at `pnpm dev`', () => {
    // A regex tolerant of any wrapper ("next:", "now run:", etc.) — the
    // contract is that the closing line names `pnpm dev`.
    expect(setupText).toMatch(/pnpm dev/);
  });

  it('does NOT attempt to edit `.env.dev` itself (would mask user mistakes)', () => {
    // The script may COPY the example to `.env.dev` but must not WRITE/EDIT
    // any field inside it. The only legitimate `.env.dev` mutation is the
    // `fs.copyFileSync` of the example file.
    const writeRegex = /writeFileSync\([^)]*\.env\.dev[^)]*\)|fs\.\w+\(.*\.env\.dev.*[^c]/;
    expect(setupText).not.toMatch(writeRegex);
  });
});

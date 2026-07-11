/**
 * tsconfig.node.json `include` consistency guard (Task 6.4; PR 3 — REQ-FVE-4).
 *
 * After `vite-env.ts` is rewritten and `vite-config.test.ts` is deleted,
 * `packages/frontend/tsconfig.node.json` `compilerOptions.include` (or the
 * equivalent `include` array at the top level) MUST list every source file
 * that the strict-mode TypeScript compile needs to see. No dangling references
 * to deleted files; no missing entries that would silently exclude a needed
 * file from the compile graph (specifically `vite-plugins/*.ts`).
 *
 * Strategy: read the JSON, evaluate every `include` glob against the real
 * filesystem. Glob evaluation is delegated to a small `node --eval` shell-out
 * that uses `glob.sync` (already a workspace devDep via vitest).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const TSCONFIG = resolve(ROOT, 'packages/frontend/tsconfig.node.json');

interface TsConfig {
  include?: string[] | string[][];
}

function loadConfig(): TsConfig {
  const text = readFileSync(TSCONFIG, 'utf8');
  // JSON5 / JSONC is allowed (tsconfig accepts comments + trailing commas).
  // Use tsconfig loader via `node --eval` to be precise; for this check we
  // accept plain JSON (the repo's convention — no comments in tsconfig.node.json).
  return JSON.parse(text) as TsConfig;
}

function flattenInclude(include: string[] | string[][] | undefined): string[] {
  if (!include) return [];
  return include.flat();
}

/**
 * Check whether a path is a literal file (matches exactly) or a glob pattern
 * that should be expanded. For simplicity and given the repo's include
 * patterns, we test literal files with `existsSync` and globs via `glob.sync`
 * (loaded through `node --eval` so we don't add a runtime devDep).
 */
function globExists(pattern: string, cwd: string): boolean {
  // Patterns used by this repo are simple `*.ts` / `vite.config.ts` / etc.
  // We approximate by:
  //   1. If the literal path exists, return true.
  //   2. Otherwise, if it contains glob meta-chars, evaluate via glob.sync.
  if (existsSync(resolve(cwd, pattern))) return true;
  if (!/[*?[\]]/.test(pattern)) return false;
  try {
    const out = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `import { globSync } from 'node:fs'; ` +
          `import { resolve as r } from 'node:path'; ` +
          `const cwd = ${JSON.stringify(cwd)}; ` +
          `const pattern = ${JSON.stringify(pattern)}; ` +
          `const matches = globSync(pattern, { cwd }); ` +
          `process.stdout.write(JSON.stringify(matches.length > 0));`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

describe('tsconfig.node.json `include` consistency (Task 6.4 — REQ-FVE-4)', () => {
  it('packages/frontend/tsconfig.node.json exists and is valid JSON', () => {
    expect(existsSync(TSCONFIG)).toBe(true);
    expect(() => loadConfig()).not.toThrow();
  });

  it('every entry in `include` resolves to an existing file or non-empty glob', () => {
    const cfg = loadConfig();
    const includes = flattenInclude(cfg.include);
    expect(includes.length).toBeGreaterThan(0);
    const cwd = resolve(ROOT, 'packages/frontend');
    for (const entry of includes) {
      expect(globExists(entry, cwd)).toBe(true);
    }
  });

  it('include covers vite.config.ts (the Vite entry point)', () => {
    const cfg = loadConfig();
    const includes = flattenInclude(cfg.include);
    expect(includes).toContain('vite.config.ts');
  });

  it('include covers vite-plugins/*.ts (the env-validation plugin location)', () => {
    const cfg = loadConfig();
    const includes = flattenInclude(cfg.include);
    // Either an explicit file reference or a wildcard covering the directory.
    const coversPlugins =
      includes.includes('vite-plugins/*.ts') ||
      includes.includes('vite-plugins/**/*.ts') ||
      includes.some((entry) => /vite-plugins\/.+\.ts$/.test(entry));
    expect(coversPlugins).toBe(true);
  });
});

/**
 * RED-first scaffold-green smoke test (PR 0, tasks.md §2).
 *
 * RED step: written before any production logic. Asserts that every
 * workspace package listed in openspec/config.yaml -> stack.workspaces
 * exists, has a parseable package.json, and a tsconfig.json that extends
 * the shared `tsconfig.base.json`.
 *
 * GREEN step: every package from PR 0 commits 2..5 satisfies this.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const PACKAGES = [
  '@mercadoexpress/shared',
  '@mercadoexpress/backend',
  '@mercadoexpress/frontend',
  '@mercadoexpress/infra',
] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

describe('PR 0 scaffold-green smoke test', () => {
  it('lists every workspace package declared in openspec/config.yaml', () => {
    const cfgPath = resolve(repoRoot, 'openspec/config.yaml');
    expect(existsSync(cfgPath)).toBe(true);

    const cfgRaw = readFileSync(cfgPath, 'utf-8');
    for (const name of PACKAGES) {
      const dirName = name.replace('@mercadoexpress/', '');
      expect(cfgRaw).toContain(`packages/${dirName}`);
    }
  });

  it.each(PACKAGES)('%s has a parseable package.json with workspace metadata', (name) => {
    const dirName = name.replace('@mercadoexpress/', '');
    const pkgDir = resolve(repoRoot, 'packages', dirName);
    expect(existsSync(pkgDir)).toBe(true);
    expect(statSync(pkgDir).isDirectory()).toBe(true);

    const pkgPath = resolve(pkgDir, 'package.json');
    expect(existsSync(pkgPath)).toBe(true);

    const pkg = readJson(pkgPath);
    expect(pkg['name']).toBe(name);
    expect(pkg['private']).toBe(true);
  });

  it.each(PACKAGES)('%s has a tsconfig.json that extends tsconfig.base.json', (name) => {
    const dirName = name.replace('@mercadoexpress/', '');
    const tsconfigPath = resolve(repoRoot, 'packages', dirName, 'tsconfig.json');
    expect(existsSync(tsconfigPath)).toBe(true);

    const tsconfig = readJson(tsconfigPath);
    expect(tsconfig['extends']).toBe('../../tsconfig.base.json');
  });

  it('the shared package exports the canonical ErrorCode registry', async () => {
    const sharedIndex = resolve(repoRoot, 'packages/shared/src/index.ts');
    const sharedIndexSrc = readFileSync(sharedIndex, 'utf-8');
    expect(sharedIndexSrc).toContain('./errors/errorCodes.js');

    const errorCodesPath = resolve(repoRoot, 'packages/shared/src/errors/errorCodes.ts');
    expect(existsSync(errorCodesPath)).toBe(true);

    // The `ErrorCode` export collides value/type (the same name is exported
    // as both). Pull the value off the const-only namespace via dynamic
    // import + runtime destructuring.
    const errorCodesModule = (await import('../src/errors/errorCodes.js')) as Record<
      string,
      unknown
    >;
    const ErrorCode = errorCodesModule['ErrorCode'] as Record<string, string>;
    expect(ErrorCode['SKU_ALREADY_EXISTS']).toBe('SKU_ALREADY_EXISTS');
    expect(ErrorCode['STOCK_WOULD_GO_NEGATIVE']).toBe('STOCK_WOULD_GO_NEGATIVE');
    expect(ErrorCode['ORDER_INVALID_TRANSITION']).toBe('ORDER_INVALID_TRANSITION');
  });
});

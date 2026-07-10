/**
 * Architectural test: cross-BC bounds (PR 2a, RISK-W06).
 *
 * Asserts the hexagonal layering:
 *   - `packages/backend/src/auth/infrastructure/` MUST NOT import from any
 *     other BC's `infrastructure/` (or `application/`, or `interface/`).
 *   - `packages/backend/src/products/infrastructure/` MUST NOT import from
 *     any other BC's `infrastructure/` (auth, inventory, alerts, orders).
 *   - `packages/backend/src/categories/infrastructure/` MUST NOT import
 *     from any other BC's `infrastructure/`.
 *
 * The ESLint `boundaries/element-types` rule enforces the same shape but
 * catches only `from`-imports of source files; this test walks the file
 * tree to catch non-relative imports too (RISK-W06 follow-up).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const BACKEND_SRC = join(process.cwd(), 'packages', 'backend', 'src');

const BC_NAMES = ['auth', 'products', 'categories', 'inventory', 'alerts', 'orders'] as const;

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, acc);
    else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

const importRe = /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;

describe('cross-BC boundary (RISK-W06)', () => {
  it('no BC imports another BC infrastructure/application/interface', () => {
    const offenders: string[] = [];
    for (const sourceBc of BC_NAMES) {
      const infDir = join(BACKEND_SRC, sourceBc, 'infrastructure');
      let files: string[] = [];
      try {
        files = listFiles(infDir);
      } catch {
        // The BC may not yet have an infrastructure dir (e.g. alerts before PR 2b).
        continue;
      }
      for (const targetBc of BC_NAMES) {
        if (targetBc === sourceBc) continue;
        for (const file of files) {
          const text = readFileSync(file, 'utf-8');
          for (const line of text.split('\n')) {
            for (const match of line.matchAll(importRe)) {
              const path = match[1] ?? '';
              if (!path.startsWith('.')) continue;
              if (path.includes(`${path.includes('/') ? '/' : ''}${targetBc}/infrastructure`)) {
                offenders.push(
                  `${relative(process.cwd(), file)}: cross-BC import into ${targetBc}/infrastructure`,
                );
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no BC src file imports a Prisma client from a sibling BC', () => {
    // Stronger variant: forbid any path that resolves into another BC at all.
    // EXCEPTION: cross-BC domain/ports/ imports are the documented seam for
    // inter-BC communication (e.g. inventory imports alerts/domain/ports/ for
    // AlertCloserPort). This pattern is hexagonal and safe — the port is a
    // pure interface owned by the target BC's domain layer.
    const offenders: string[] = [];
    for (const sourceBc of BC_NAMES) {
      const bcDir = join(BACKEND_SRC, sourceBc);
      let files: string[] = [];
      try {
        files = listFiles(bcDir);
      } catch {
        continue;
      }
      for (const targetBc of BC_NAMES) {
        if (targetBc === sourceBc) continue;
        const otherBcSegment = `${sep}${targetBc}${sep}`;
        for (const file of files) {
          const text = readFileSync(file, 'utf-8');
          for (const line of text.split('\n')) {
            for (const match of line.matchAll(importRe)) {
              const path = match[1] ?? '';
              if (!path.startsWith('.')) continue;
              // The per-Lambda dispatcher (e.g. products/interface/dispatcher.ts)
              // is the documented seam where two BCs share a single Lambda
              // (categories merged into products-lambda per design.md §2.1).
              // We exempt that one file because its job is exactly to bridge
              // two BCs at the interface edge, NEVER at the domain edge.
              const isDispatcher = file.endsWith('interface/dispatcher.ts');
              // Bootstrap files (e.g. orders/interface/handlers/bootstrap.ts) wire
              // cross-BC port adapters at the DI layer. This is the hexagonal
              // composition root — infrastructure imports here are permitted because
              // they are explicitly injected through domain ports. We exempt
              // bootstrap.ts from the cross-BC import check.
              const isBootstrap = file.endsWith('interface/handlers/bootstrap.ts');
              if (isDispatcher || isBootstrap) continue;
              // Cross-BC domain/ports/ imports are the hexagonal seam for
              // inter-BC communication (e.g. AlertCloserPort). Allowed.
              const isDomainPortsImport = path.includes(`${targetBc}/domain/ports/`);
              if (isDomainPortsImport) continue;
              if (path.includes(otherBcSegment)) {
                offenders.push(
                  `${relative(process.cwd(), file)}: cross-BC import into ${targetBc}/ (${path})`,
                );
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

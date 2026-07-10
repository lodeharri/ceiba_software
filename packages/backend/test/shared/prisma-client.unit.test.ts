/**
 * RED-first tests for `buildPrismaUrl()` (PR 2, tasks.md §2 PR 2 — `prisma-client.ts` sslmode stage awareness).
 *
 * Asserts the stage-aware DATABASE_URL composition locked in design.md §3.15:
 *   - STAGE=localstack + raw URL without sslmode → appended `sslmode=disable`.
 *   - STAGE=dev|prod + raw URL without sslmode    → appended `sslmode=require`.
 *   - URL that already has `sslmode=require`      → preserved unchanged.
 *   - URL with existing query params              → preserved + sslmode added.
 *   - Empty URL string                            → throws `DATABASE_URL env var is not configured`.
 *
 * RED state: `buildPrismaUrl` is not exported yet → import fails at module
 * load, every assertion unreachable. GREEN state lands in the next commit
 * (the `prisma-client.ts` refactor in PR 2).
 */

import { describe, it, expect } from 'vitest';

interface ModuleUnderTest {
  buildPrismaUrl: (rawUrl: string, stage: string, connectionLimit: number) => string;
}

function loadModule(): ModuleUnderTest {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../dist/src/shared/prisma-client.js') as ModuleUnderTest;
}

describe('buildPrismaUrl (PR 2 — stage-aware sslmode)', () => {
  it("appends sslmode=disable when stage='localstack' and the URL has no sslmode", () => {
    const { buildPrismaUrl } = loadModule();
    const url = buildPrismaUrl('postgresql://u:p@h:5432/d', 'localstack', 2);
    expect(url).toContain('sslmode=disable');
    expect(url).not.toContain('sslmode=require');
  });

  it("appends sslmode=require when stage='dev' and the URL has no sslmode", () => {
    const { buildPrismaUrl } = loadModule();
    const url = buildPrismaUrl('postgresql://u:p@h:5432/d', 'dev', 2);
    expect(url).toContain('sslmode=require');
    expect(url).not.toContain('sslmode=disable');
  });

  it("appends sslmode=require when stage='prod' and the URL has no sslmode", () => {
    const { buildPrismaUrl } = loadModule();
    const url = buildPrismaUrl('postgresql://u:p@h:5432/d', 'prod', 2);
    expect(url).toContain('sslmode=require');
  });

  it('preserves an existing sslmode=require without overriding it', () => {
    const { buildPrismaUrl } = loadModule();
    const input = 'postgresql://u:p@h:5432/d?sslmode=require';
    const url = buildPrismaUrl(input, 'localstack', 2);
    // The localstack stage MUST NOT downgrade sslmode=require to disable
    // when one is already explicit in the URL.
    expect(url).toContain('sslmode=require');
    expect(url).not.toContain('sslmode=disable');
  });

  it('preserves existing query params (e.g. pool_mode=transaction) and still appends sslmode', () => {
    const { buildPrismaUrl } = loadModule();
    const url = buildPrismaUrl('postgresql://u:p@h:5432/d?pool_mode=transaction', 'dev', 2);
    expect(url).toContain('pool_mode=transaction');
    expect(url).toContain('sslmode=require');
  });

  it('throws a clear error when the URL is empty', () => {
    const { buildPrismaUrl } = loadModule();
    expect(() => buildPrismaUrl('', 'localstack', 2)).toThrow(
      /DATABASE_URL env var is not configured/,
    );
  });

  it('preserves connection_limit when already present', () => {
    const { buildPrismaUrl } = loadModule();
    const url = buildPrismaUrl('postgresql://u:p@h:5432/d?connection_limit=5', 'dev', 2);
    expect(url).toContain('connection_limit=5');
    expect(url).toContain('sslmode=require');
  });

  it('appends connection_limit when missing', () => {
    const { buildPrismaUrl } = loadModule();
    const url = buildPrismaUrl('postgresql://u:p@h:5432/d', 'dev', 4);
    expect(url).toContain('connection_limit=4');
    expect(url).toContain('sslmode=require');
  });
});

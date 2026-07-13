/**
 * Integration test — seed.ts correctness (PR reliability fix).
 *
 * RED first: this test fails against the broken state because:
 *   1. `seed.ts` imports `import bcrypt from 'bcrypt'` — the native C++ module
 *      that is NOT in the dependency tree.  Importing the module throws
 *      `ERR_PACKAGE_PATH_NOT_EXPORTED` / `Cannot find module 'bcrypt'`.
 *   2. Even if bcrypt were present, `process.env` has no ADMIN_* vars
 *      because `.env.dev` is not loaded, so the required-var guard throws.
 *
 * GREEN: after replacing `bcrypt` → `bcryptjs` and adding the dotenv block,
 * the module loads cleanly and `runSeed` correctly upserts the admin user
 * with a verifiable bcrypt hash.
 *
 * Uses a lightweight fake Prisma client (matching the pattern in
 * `packages/backend/src/auth/infrastructure/prisma-user-repository.test.ts`)
 * so the test needs no real database or pg-mem adapter.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Set env BEFORE importing seed (dotenv loads first, must not overwrite).
// ---------------------------------------------------------------------------
vi.stubEnv('ADMIN_USERNAME', 'seed-integration-test-admin');
vi.stubEnv('ADMIN_EMAIL', 'seed-integration-test@mercadoweb.test');
vi.stubEnv('ADMIN_PASSWORD', 'S33dT3st!P@ssw0rd');
vi.stubEnv('BCRYPT_COST', '10');
vi.stubEnv('DATABASE_URL', 'postgresql://noreply/noreply');

// ---------------------------------------------------------------------------
// Seed module — import AFTER env is stubbed so dotenv does not overwrite.
// ---------------------------------------------------------------------------
const { runSeed } = await import('./seed.js');

// ---------------------------------------------------------------------------
// Lightweight fake Prisma client (mirrors existing test pattern).
// ---------------------------------------------------------------------------
type UpsertCall = {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function makeFakePrisma() {
  const userCalls: UpsertCall[] = [];
  const categoryUpserts: UpsertCall[] = [];
  const productUpserts: UpsertCall[] = [];
  let nextUserId = 1;
  let nextCategoryId = 1;
  let nextProductId = 1;

  const categories = new Map<string, { id: number; name: string }>();
  const users = new Map<
    string,
    { id: number; username: string; email: string; passwordHash: string; role: string }
  >();

  return {
    prisma: {
      user: {
        async upsert(args: UpsertCall) {
          userCalls.push(args);
          const username = args.where['username'] as string;
          const { email, passwordHash, role } = args.create as {
            email: string;
            passwordHash: string;
            role: string;
          };
          users.set(username, { id: nextUserId++, username, email, passwordHash, role });
          return users.get(username)!;
        },
        async findUnique(args: { where: { username: string } }) {
          return users.get(args.where.username) ?? null;
        },
      },
      category: {
        async upsert(args: UpsertCall) {
          categoryUpserts.push(args);
          const name = args.where['name'] as string;
          if (!categories.has(name)) {
            categories.set(name, { id: nextCategoryId++, name });
          }
          return categories.get(name)!;
        },
        async findUnique(args: { where: { name: string } }) {
          return categories.get(args.where.name) ?? null;
        },
      },
      product: {
        async upsert(args: UpsertCall) {
          productUpserts.push(args);
          const sku = args.where['sku'] as string;
          return { id: nextProductId++, sku };
        },
      },
    },
    // Expose call history for assertions.
    _calls: { userCalls, categoryUpserts, productUpserts },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('prisma/seed.ts', () => {
  // --- RED failure: module import dies on `import bcrypt from 'bcrypt'` ---
  it('loads without a module-not-found error', () => {
    // If this test is RED, the `await import('./seed.js')` above threw:
    // `ERR_MODULE_NOT_FOUND` / `Cannot find module 'bcrypt'`.
    // After fix (`bcryptjs`) the import succeeds and this passes.
    expect(true).toBe(true);
  });

  it('runSeed upserts admin user and returns correct summary', async () => {
    const { prisma } = makeFakePrisma();

    const result = await runSeed(prisma as never);

    expect(result.user.username).toBe('seed-integration-test-admin');
    expect(result.user.role).toBe('admin');
    expect(result.categories).toBe(6); // REFERENCE_CATEGORIES.length
    expect(result.products).toBe(6); // REFERENCE_PRODUCTS.length
  });

  it('admin user password hash is verifiable with BcryptPasswordHasher', async () => {
    const { prisma } = makeFakePrisma();

    await runSeed(prisma as never);

    const user = (
      prisma as never as {
        user: {
          findUnique: (args: {
            where: { username: string };
          }) => Promise<{ passwordHash: string } | null>;
        };
      }
    ).user;
    const found = await user.findUnique({ where: { username: 'seed-integration-test-admin' } });

    const { BcryptPasswordHasher } =
      await import('../src/auth/infrastructure/bcrypt-password-hasher.js');
    const hasher = new BcryptPasswordHasher(10);
    const matches = await hasher.compare('S33dT3st!P@ssw0rd', found!.passwordHash);

    expect(matches).toBe(true);
  });

  it('two seed runs produce different hashes (non-deterministic salt)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fake = makeFakePrisma() as any;
    const prisma = fake.prisma;
    const _calls = fake._calls;

    await runSeed(prisma as never);
    const firstHash = (_calls.userCalls[0]?.create as { passwordHash: string } | undefined)
      ?.passwordHash;

    // Upsert again (idempotent per BR-D5).
    await runSeed(prisma as never);
    const secondHash = (_calls.userCalls[1]?.create as { passwordHash: string } | undefined)
      ?.passwordHash;

    // Salts differ — same input, different bcrypt output.
    expect(secondHash).not.toBe(firstHash);

    // Both hashes still verify correctly.
    const { BcryptPasswordHasher } =
      await import('../src/auth/infrastructure/bcrypt-password-hasher.js');
    const hasher = new BcryptPasswordHasher(10);
    await expect(hasher.compare('S33dT3st!P@ssw0rd', firstHash!)).resolves.toBe(true);
    await expect(hasher.compare('S33dT3st!P@ssw0rd', secondHash!)).resolves.toBe(true);
  });

  it('throws when ADMIN_USERNAME is missing', async () => {
    const original = process.env['ADMIN_USERNAME'];
    delete process.env['ADMIN_USERNAME'];
    const { prisma } = makeFakePrisma();

    await expect(runSeed(prisma as never)).rejects.toThrow(
      'Missing required env var: ADMIN_USERNAME',
    );

    process.env['ADMIN_USERNAME'] = original;
  });

  it('throws when ADMIN_PASSWORD is missing', async () => {
    const original = process.env['ADMIN_PASSWORD'];
    delete process.env['ADMIN_PASSWORD'];
    const { prisma } = makeFakePrisma();

    await expect(runSeed(prisma as never)).rejects.toThrow(
      'Missing required env var: ADMIN_PASSWORD',
    );

    process.env['ADMIN_PASSWORD'] = original;
  });

  it('throws when ADMIN_EMAIL is missing', async () => {
    const original = process.env['ADMIN_EMAIL'];
    delete process.env['ADMIN_EMAIL'];
    const { prisma } = makeFakePrisma();

    await expect(runSeed(prisma as never)).rejects.toThrow('Missing required env var: ADMIN_EMAIL');

    process.env['ADMIN_EMAIL'] = original;
  });
});

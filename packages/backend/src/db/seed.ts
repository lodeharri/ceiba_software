/**
 * Reference-data bootstrap (PR 1.2, design.md §10.2 + shared/spec.md).
 *
 * Idempotent upserts keyed on stable identifiers (`username`, `name`, `sku`).
 * Reads `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` from env — all
 * resolved at Lambda startup via SSM SecureString.
 *
 * Loaded by the setup script:
 *
 *   pnpm db:seed
 *
 * bcrypt cost 10 (D6). Exits non-zero if a required env var is missing
 * so the setup marks failure rather than silently seeding a partial dataset.
 *
 * All write operations (admin + categories + products) are wrapped in a single
 * `db.transaction(...)` call so they are atomic: either all succeed or none
 * is persisted. This also makes the seed idempotent at the transaction level —
 * a second run produces the same end-state without duplicates.
 *
 * Upsert logic uses Drizzle's `onConflictDoUpdate` to avoid a select-then-
 * insert/update race between concurrent seed invocations.
 */

import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = import.meta.url ? fileURLToPath(import.meta.url) : process.argv[1]!;
const seedFile = dirname(__filename);
const backendDir = dirname(seedFile);
const packagesDir = dirname(backendDir);
const workspaceRoot = dirname(packagesDir);

if (existsSync(`${workspaceRoot}/.env.dev`)) {
  loadDotenv({ path: `${workspaceRoot}/.env.dev` });
} else if (existsSync(`${workspaceRoot}/.env.dev.example`)) {
  loadDotenv({ path: `${workspaceRoot}/.env.dev.example` });
} else {
  loadDotenv();
}

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '../shared/db.js';
import { users, categories, products } from './schema.js';

const BCRYPT_COST = Number(process.env['BCRYPT_COST'] ?? 10);

/**
 * Read a required env var or throw with an explicit message.
 * Centralizes the validation so callers never need non-null assertions.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const REFERENCE_CATEGORIES = [
  'Bebidas',
  'Lácteos',
  'Snacks',
  'Limpieza',
  'Frutas',
  'Granos',
] as const;

interface ReferenceProduct {
  sku: string;
  name: string;
  categoryName: string;
  price: number;
  stock: number;
  stockMin: number;
  supplier: string;
}

const REFERENCE_PRODUCTS: ReferenceProduct[] = [
  {
    sku: 'BEB-001',
    name: 'Agua Mineral 500ml',
    categoryName: 'Bebidas',
    price: 1500,
    stock: 200,
    stockMin: 50,
    supplier: 'Distribuidora Andina',
  },
  {
    sku: 'BEB-002',
    name: 'Gaseosa Cola 1.5L',
    categoryName: 'Bebidas',
    price: 6500,
    stock: 80,
    stockMin: 30,
    supplier: 'Distribuidora Andina',
  },
  {
    sku: 'LAC-001',
    name: 'Leche Entera 1L',
    categoryName: 'Lácteos',
    price: 4200,
    stock: 150,
    stockMin: 40,
    supplier: 'Lácteos del Valle',
  },
  {
    sku: 'LAC-002',
    name: 'Queso Campesino 500g',
    categoryName: 'Lácteos',
    price: 9800,
    stock: 45,
    stockMin: 20,
    supplier: 'Lácteos del Valle',
  },
  {
    sku: 'SNK-001',
    name: 'Papas Fritas 150g',
    categoryName: 'Snacks',
    price: 3500,
    stock: 120,
    stockMin: 30,
    supplier: 'Snacks del Sur',
  },
  {
    sku: 'LIM-001',
    name: 'Detergente Lavaplatos 500ml',
    categoryName: 'Limpieza',
    price: 5400,
    stock: 60,
    stockMin: 25,
    supplier: 'Aseo Total',
  },
];

/**
 * Seeds the database with an admin user + 6 reference categories + 6 reference products.
 *
 * All writes are wrapped in a single `db.transaction(...)` so the operation is
 * atomic: either all rows land or none does. Idempotency is guaranteed by
 * `onConflictDoUpdate` against stable keys (`username`, `name`, `sku`),
 * which makes the seed safe to re-run.
 *
 * Required env vars: ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD.
 * Optional env var: BCRYPT_COST (default 10).
 *
 * @throws if any required env var is missing or empty.
 * @throws if `bcrypt.hash` rejects (e.g. invalid BCRYPT_COST).
 * @throws if the DB transaction fails (connection, constraint, etc.).
 *   Callers should treat any thrown error as a non-recoverable seed failure.
 */
export async function runSeed(): Promise<{
  user: { username: string; role: string };
  categories: number;
  products: number;
}> {
  const username = requireEnv('ADMIN_USERNAME');
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');

  const db = getDb();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // All writes in one atomic transaction.
  await db.transaction(async (tx) => {
    // 1. Admin user — upsert on username (BR-D5 idempotency rule).
    await tx
      .insert(users)
      .values({
        id: randomUUID(),
        username,
        email,
        passwordHash,
        role: 'admin',
      })
      .onConflictDoUpdate({
        target: users.username,
        set: { email, passwordHash, role: 'admin' },
      });

    // 2. Six reference categories — upsert on name.
    for (const name of REFERENCE_CATEGORIES) {
      await tx.insert(categories).values({ id: randomUUID(), name }).onConflictDoUpdate({
        target: categories.name,
        set: { name },
      });
    }

    // 3. Six reference products — upsert on sku (requires category id).
    for (const p of REFERENCE_PRODUCTS) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, p.categoryName))
        .limit(1);

      if (!category) {
        throw new Error(
          `Seed invariant violated: category '${p.categoryName}' missing after categories upsert.`,
        );
      }

      await tx
        .insert(products)
        .values({
          id: randomUUID(),
          sku: p.sku,
          name: p.name,
          categoryId: category.id,
          price: String(p.price),
          stock: p.stock,
          stockMin: p.stockMin,
          supplier: p.supplier,
        })
        .onConflictDoUpdate({
          target: products.sku,
          set: {
            name: p.name,
            categoryId: category.id,
            price: String(p.price),
            stock: p.stock,
            stockMin: p.stockMin,
            supplier: p.supplier,
          },
        });
    }
  });

  return {
    user: { username, role: 'admin' },
    categories: REFERENCE_CATEGORIES.length,
    products: REFERENCE_PRODUCTS.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const startedAt = Date.now();
  try {
    const result = await runSeed();
    process.stdout.write(
      JSON.stringify({
        level: 'info',
        msg: 'seed completed',
        durationMs: Date.now() - startedAt,
        ...result,
      }) + '\n',
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'error',
        msg: 'seed failed',
        cause: err instanceof Error ? err.message : String(err),
      }) + '\n',
    );
    process.exit(1);
  }
}

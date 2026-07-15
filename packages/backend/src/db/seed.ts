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
 */

import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { getDb } from '../shared/db.js';

const BCRYPT_COST = Number(process.env['BCRYPT_COST'] ?? 10);

const REQUIRED_ENV_VARS = ['ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'] as const;

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

export async function runSeed(): Promise<{
  user: { username: string; role: string };
  categories: number;
  products: number;
}> {
  for (const name of REQUIRED_ENV_VARS) {
    if (!process.env[name] || process.env[name]!.length === 0) {
      throw new Error(`Missing required env var: ${name}`);
    }
  }

  const db = getDb();

  const username = process.env['ADMIN_USERNAME']!;
  const email = process.env['ADMIN_EMAIL']!.toLowerCase();
  const password = process.env['ADMIN_PASSWORD']!;

  // 1. Admin user — upsert on username (BR-D5 idempotency rule).
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Try insert first; if user exists, update
  const { eq } = await import('drizzle-orm');
  const { users } = await import('./schema.js');

  // Check if user exists
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  let userId: string;
  if (existing) {
    // Update
    await db
      .update(users)
      .set({ email, passwordHash, role: 'admin' })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    // Insert
    const { randomUUID } = await import('node:crypto');
    const [inserted] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        username,
        email,
        passwordHash,
        role: 'admin',
      })
      .returning({ id: users.id });
    userId = inserted!.id;
  }

  // 2. Six reference categories — upsert on name.
  const { categories } = await import('./schema.js');
  for (const name of REFERENCE_CATEGORIES) {
    const [existingCat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, name))
      .limit(1);
    if (!existingCat) {
      const { randomUUID } = await import('node:crypto');
      await db.insert(categories).values({ id: randomUUID(), name });
    }
  }

  // 3. Six reference products — upsert on sku (requires category id).
  let productCount = 0;
  const { products } = await import('./schema.js');
  for (const p of REFERENCE_PRODUCTS) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, p.categoryName))
      .limit(1);
    if (!category) {
      throw new Error(
        `Seed invariant violated: category '${p.categoryName}' missing after categories upsert.`,
      );
    }

    const [existingProd] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.sku, p.sku))
      .limit(1);

    if (existingProd) {
      await db
        .update(products)
        .set({
          name: p.name,
          categoryId: category.id,
          price: String(p.price),
          stock: p.stock,
          stockMin: p.stockMin,
          supplier: p.supplier,
        })
        .where(eq(products.id, existingProd.id));
    } else {
      const { randomUUID } = await import('node:crypto');
      await db.insert(products).values({
        id: randomUUID(),
        sku: p.sku,
        name: p.name,
        categoryId: category.id,
        price: String(p.price),
        stock: p.stock,
        stockMin: p.stockMin,
        supplier: p.supplier,
      });
    }
    productCount += 1;
  }

  return {
    user: { username, role: 'admin' },
    categories: REFERENCE_CATEGORIES.length,
    products: productCount,
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

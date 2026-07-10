/**
 * Reference-data bootstrap (PR 2a, design.md §10.2 + shared/spec.md).
 *
 * Idempotent upserts keyed on stable identifiers (`username`, `name`, `sku`).
 * Reads `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` from env — all
 * resolved at Lambda startup via SSM SecureString (`/MercadoExpress/{stage}/admin-password`,
 * PR 1 BLOCKER C3 closeout).
 *
 * Loaded by the migrations CustomResource Lambda:
 *
 *   pnpm exec tsx prisma/seed.ts
 *
 * bcrypt cost 10 (D6). Exits non-zero if a required env var is missing
 * so the CustomResource marks the stack CREATE_FAILED rather than
 * silently seeding a partial dataset (auth/spec.md "Missing env vars").
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

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

interface SeedResult {
  user: { username: string; role: string };
  categories: number;
  products: number;
}

export async function runSeed(prisma: PrismaClient): Promise<SeedResult> {
  for (const name of REQUIRED_ENV_VARS) {
    if (!process.env[name] || process.env[name]!.length === 0) {
      throw new Error(`Missing required env var: ${name}`);
    }
  }

  const username = process.env['ADMIN_USERNAME']!;
  const email = process.env['ADMIN_EMAIL']!.toLowerCase();
  const password = process.env['ADMIN_PASSWORD']!;

  // 1. Admin user — upsert on username (BR-D5 idempotency rule).
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await prisma.user.upsert({
    where: { username },
    update: { email, passwordHash, role: 'admin' },
    create: { username, email, passwordHash, role: 'admin' },
  });

  // 2. Six reference categories — upsert on name.
  for (const name of REFERENCE_CATEGORIES) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 3. Six reference products — upsert on sku (requires category id).
  let productCount = 0;
  for (const p of REFERENCE_PRODUCTS) {
    const category = await prisma.category.findUnique({
      where: { name: p.categoryName },
    });
    if (!category) {
      throw new Error(
        `Seed invariant violated: category '${p.categoryName}' missing after categories upsert.`,
      );
    }
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        categoryId: category.id,
        price: p.price,
        stock: p.stock,
        stockMin: p.stockMin,
        supplier: p.supplier,
      },
      create: {
        sku: p.sku,
        name: p.name,
        categoryId: category.id,
        price: p.price,
        stock: p.stock,
        stockMin: p.stockMin,
        supplier: p.supplier,
      },
    });
    productCount += 1;
  }

  return {
    user: { username: user.username, role: user.role },
    categories: REFERENCE_CATEGORIES.length,
    products: productCount,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  const startedAt = Date.now();
  try {
    const result = await runSeed(prisma);
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
  } finally {
    await prisma.$disconnect();
  }
}

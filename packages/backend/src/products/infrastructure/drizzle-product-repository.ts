/**
 * Products BC — DrizzleProductRepository (PR 1.2).
 *
 * Adapter implementing `ProductRepository` against Drizzle ORM.
 * Replaces `PrismaProductRepository` for the Prisma → Drizzle migration.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type {
  ProductRepository,
  ProductFilters,
  ListOptions,
  Page,
  ProductProps,
} from '../domain/ports/product-repository.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';
import type { Pool as PgPool } from 'pg';

interface DrizzleProductRow {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  price: string; // Drizzle decimal → string
  stock: number;
  stockMin: number;
  supplier: string;
  embedding?: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<ProductProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    return row ? toProps(row) : null;
  }

  async findBySku(sku: string): Promise<ProductProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.sku, sku.toUpperCase()))
      .limit(1);
    return row ? toProps(row) : null;
  }

  async create(p: ProductProps): Promise<ProductProps> {
    const rows = await this.db
      .insert(schema.products)
      .values({ ...p, price: String(p.price) })
      .returning();
    return toProps(rows[0]!);
  }

  async update(
    id: string,
    partial: Partial<Pick<ProductProps, 'name' | 'supplier' | 'price' | 'stockMin' | 'categoryId'>>,
  ): Promise<ProductProps> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (partial.name !== undefined) setValues.name = partial.name;
    if (partial.supplier !== undefined) setValues.supplier = partial.supplier;
    if (partial.price !== undefined) setValues.price = String(partial.price);
    if (partial.stockMin !== undefined) setValues.stockMin = partial.stockMin;
    if (partial.categoryId !== undefined) setValues.categoryId = partial.categoryId;

    const rows = await this.db
      .update(schema.products)
      .set(setValues)
      .where(eq(schema.products.id, id))
      .returning();
    return toProps(rows[0]!);
  }

  async list(opts: ListOptions): Promise<Page<ProductProps>> {
    const page = Math.max(1, opts.page);
    const size = Math.max(1, Math.min(100, opts.size));
    const where = buildWhere(opts.filters, opts.productIds);

    const items = await this.db
      .select()
      .from(schema.products)
      .where(where)
      .orderBy(schema.products.name)
      .limit(size)
      .offset((page - 1) * size);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(where)
      .limit(1);

    return {
      items: items.map(toProps),
      page,
      size,
      total: countRow?.count ?? 0,
      hasMore: page * size < (countRow?.count ?? 0),
    };
  }

  async findByEmbedding(
    embedding: number[],
    opts: { limit: number; minSimilarity?: number },
  ): Promise<ProductProps[]> {
    const limit = Math.max(1, Math.min(50, opts.limit));
    const minSim = opts.minSimilarity ?? 0.0;

    // pgvector string literal: '[v1,v2,...]'::vector
    // Interpolation here is safe: `embedding` is a 768-element number[] from
    // Gemini's API (validated floats, not user input), so there is zero injection risk.
    // Using raw pool query avoids Drizzle binding this as 768 individual parameters.
    const vectorLiteral = `'[${embedding}]'::vector`;
    const minSimClause = minSim > 0 ? ` AND (embedding <=> ${vectorLiteral}) <= ${1 - minSim}` : '';

    const rows = await (this.db.$client as PgPool).query<DrizzleProductRow>(
      `SELECT id, sku, name, category_id, price, stock, stock_min, supplier, description, embedding, created_at, updated_at FROM products WHERE embedding IS NOT NULL${minSimClause} ORDER BY embedding <=> ${vectorLiteral} LIMIT $1`,
      [limit],
    );

    return rows.rows.map(toProps);
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    // Interpolation is safe: `embedding` is a Gemini API float array (not user input).
    // Raw pool query avoids Drizzle expanding 768-element array as individual bindings.
    const vectorLiteral = `'[${embedding}]'::vector`;
    await (this.db.$client as PgPool).query(
      `UPDATE products SET embedding = ${vectorLiteral} WHERE id = $1`,
      [id],
    );
  }
}

function toProps(row: DrizzleProductRow): ProductProps {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    price:
      typeof row.price === 'number'
        ? row.price
        : typeof row.price === 'string'
          ? Number(row.price)
          : 0,
    stock: row.stock,
    stockMin: row.stockMin,
    supplier: row.supplier,
    embedding: row.embedding ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function buildWhere(f?: ProductFilters, productIds?: readonly string[] | undefined) {
  const conditions = [];
  if (productIds !== undefined) {
    conditions.push(inArray(schema.products.id, [...productIds]));
  }
  if (f?.categoryId) conditions.push(eq(schema.products.categoryId, f.categoryId));
  if (f?.supplier) conditions.push(eq(schema.products.supplier, f.supplier));
  if (f?.minStock !== undefined || f?.maxStock !== undefined) {
    const stockConds = [];
    if (f.minStock !== undefined) stockConds.push(gte(schema.products.stock, f.minStock));
    if (f.maxStock !== undefined) stockConds.push(lte(schema.products.stock, f.maxStock));
    if (stockConds.length > 0) conditions.push(and(...stockConds));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

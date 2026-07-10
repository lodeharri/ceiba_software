/**
 * Products BC — PrismaProductRepository (PR 2a).
 *
 * Adapter implementing `ProductRepository` against `@prisma/client`.
 * Uses a minimal PrismaLike surface so the production build works
 * once `prisma generate` runs in the migrations Lambda (PR 2a wires
 * `prisma migrate deploy`; PR 4 builds the generated client at
 * runtime inside the Lambda image, when it ships).
 */

import type {
  ProductRepository,
  ProductFilters,
  ListOptions,
  Page,
  ProductProps,
} from '../domain/ports/product-repository.js';

interface PrismaProductRow {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  price: unknown; // Decimal; serialized to integer via toString()
  stock: number;
  stockMin: number;
  supplier: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DecimalLike {
  toString(): string;
}

/** Minimal Prisma surface the product repository needs. */
export interface ProductPrisma {
  product: {
    findUnique(args: { where: { id?: string; sku?: string } }): Promise<PrismaProductRow | null>;
    create(args: {
      data: Omit<PrismaProductRow, 'createdAt' | 'updatedAt'> & {
        createdAt?: Date;
        updatedAt?: Date;
      };
    }): Promise<PrismaProductRow>;
    update(args: {
      where: { id: string };
      data: {
        name?: string;
        supplier?: string;
        price?: unknown;
        stockMin?: number;
        categoryId?: string;
        updatedAt?: Date;
      };
    }): Promise<PrismaProductRow>;
    findMany(args: {
      where: {
        categoryId?: string;
        supplier?: { contains: string };
        stock?: { gte?: number; lte?: number };
      };
      orderBy: { name: 'asc' | 'desc' };
      skip: number;
      take: number;
    }): Promise<PrismaProductRow[]>;
    count(args: { where: object }): Promise<number>;
  };
}

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: ProductPrisma) {}

  async findById(id: string): Promise<ProductProps | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row ? toProps(row) : null;
  }

  async findBySku(sku: string): Promise<ProductProps | null> {
    const row = await this.prisma.product.findUnique({ where: { sku: sku.toUpperCase() } });
    return row ? toProps(row) : null;
  }

  async create(p: ProductProps): Promise<ProductProps> {
    const row = await this.prisma.product.create({
      data: { ...p, price: p.price as unknown as DecimalLike },
    });
    return toProps(row);
  }

  async update(
    id: string,
    partial: Partial<Pick<ProductProps, 'name' | 'supplier' | 'price' | 'stockMin' | 'categoryId'>>,
  ): Promise<ProductProps> {
    const row = await this.prisma.product.update({
      where: { id },
      data: { ...partial, updatedAt: new Date() } as Parameters<
        ProductPrisma['product']['update']
      >[0]['data'],
    });
    return toProps(row);
  }

  async list(opts: ListOptions): Promise<Page<ProductProps>> {
    const page = Math.max(1, opts.page);
    const size = Math.max(1, Math.min(100, opts.size));
    const where = buildWhere(opts.filters);
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: items.map(toProps),
      page,
      size,
      total,
      hasMore: page * size < total,
    };
  }
}

function toProps(row: PrismaProductRow): ProductProps {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    price:
      typeof row.price === 'number'
        ? row.price
        : typeof (row.price as { toString(): string }).toString === 'function'
          ? Number((row.price as { toString(): string }).toString())
          : 0,
    stock: row.stock,
    stockMin: row.stockMin,
    supplier: row.supplier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildWhere(
  f?: ProductFilters,
): Parameters<ProductPrisma['product']['findMany']>[0]['where'] {
  const where: Parameters<ProductPrisma['product']['findMany']>[0]['where'] = {};
  if (f?.categoryId) where.categoryId = f.categoryId;
  if (f?.supplier) where.supplier = { contains: f.supplier };
  if (f?.minStock !== undefined || f?.maxStock !== undefined) {
    where.stock = {};
    if (f.minStock !== undefined) where.stock.gte = f.minStock;
    if (f.maxStock !== undefined) where.stock.lte = f.maxStock;
  }
  // `hasActiveAlert` is PR 2b territory; ignore here.
  return where;
}

/**
 * Products BC — Product aggregate (PR 2a, products/spec.md).
 *
 * Invariants enforced at construction (products/spec.md "Create product"):
 *   - name       3-100 chars, non-empty
 *   - sku        [A-Za-z0-9-]{6,20} (PR 0 deviation: hyphen allowed for seed SKUs)
 *   - price      integer COP > 0
 *   - stock      >= 0
 *   - stockMin   > 0
 *   - supplier   1-120 chars, non-empty
 *   - categoryId UUID
 *
 * Wire format (read model) — matches `packages/shared/src/schemas/products/product.ts`:
 *   - price          integer COP serialized as a string ("1234", never 1234)
 *                    per design.md D4 (avoid Number precision loss in JS JSON)
 *   - hasActiveAlert boolean denormalized from the alerts BC; the entity
 *                    does not own it — callers set it via `withAlertFlag`
 *                    so the read model can carry the flag without polluting
 *                    domain invariants.
 */

import { MoneySerializer } from '@mercadoexpress/shared';

const SKU_REGEX = /^[A-Za-z0-9-]{6,20}$/;
const UUID_V4_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ProductProps {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  price: number; // integer COP
  stock: number;
  stockMin: number;
  supplier: string;
  /** Product description — used in semantic search embedding text. */
  description?: string | null;
  /** Semantic search embedding — populated asynchronously via Gemini. */
  embedding?: number[] | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Product {
  private constructor(
    public readonly props: ProductProps,
    private readonly alertFlag: boolean = false,
  ) {}

  static create(input: {
    id: string;
    sku: string;
    name: string;
    categoryId: string;
    price: number;
    stock: number;
    stockMin: number;
    supplier: string;
    createdAt?: Date;
    updatedAt?: Date;
  }): Product {
    Product.assertInvariants(input);
    return new Product({
      ...input,
      sku: input.sku.toUpperCase(),
      name: input.name.trim(),
    });
  }

  static rehydrate(props: ProductProps): Product {
    return new Product({ ...props, sku: props.sku.toUpperCase(), name: props.name.trim() });
  }

  /**
   * Returns a NEW Product instance carrying the given `hasActiveAlert`
   * value. Use cases call this after consulting `AlertReadModelPort`
   * so the read model can emit the field without leaking alert
   * concerns into the domain invariants.
   */
  withAlertFlag(flag: boolean): Product {
    return new Product(this.props, flag);
  }

  static assertInvariants(p: ProductProps): void {
    if (!p.name || p.name.trim().length < 3 || p.name.trim().length > 100) {
      throw new Error('Product.name must be 3-100 chars');
    }
    if (!SKU_REGEX.test(p.sku)) {
      throw new Error('Product.sku must match [A-Za-z0-9-]{6,20}');
    }
    if (!UUID_V4_REGEX.test(p.categoryId)) {
      throw new Error('Product.categoryId must be a UUID');
    }
    if (!Number.isInteger(p.price) || p.price <= 0) {
      throw new Error('Product.price must be an integer > 0');
    }
    if (!Number.isInteger(p.stock) || p.stock < 0) {
      throw new Error('Product.stock must be an integer >= 0');
    }
    if (!Number.isInteger(p.stockMin) || p.stockMin <= 0) {
      throw new Error('Product.stockMin must be an integer > 0');
    }
    if (!p.supplier || p.supplier.trim().length < 1 || p.supplier.length > 120) {
      throw new Error('Product.supplier must be 1-120 chars');
    }
  }

  get id(): string {
    return this.props.id;
  }
  get sku(): string {
    return this.props.sku;
  }
  get name(): string {
    return this.props.name;
  }
  get categoryId(): string {
    return this.props.categoryId;
  }
  get price(): number {
    return this.props.price;
  }
  get stock(): number {
    return this.props.stock;
  }
  get stockMin(): number {
    return this.props.stockMin;
  }
  get supplier(): string {
    return this.props.supplier;
  }
  get description(): string | null | undefined {
    return this.props.description;
  }
  get createdAt(): Date | undefined {
    return this.props.createdAt;
  }
  get updatedAt(): Date | undefined {
    return this.props.updatedAt;
  }

  /** Read model used by the interface layer (response mapper). */
  toReadModel(): {
    id: string;
    sku: string;
    name: string;
    price: string;
    stock: number;
    stockMin: number;
    supplier: string;
    categoryId: string;
    hasActiveAlert: boolean;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: this.props.id,
      sku: this.props.sku,
      name: this.props.name,
      // D4 / `packages/shared/src/primitives/money.ts`: Money on the wire
      // is an integer-COP string. Number values lose precision above 2^53
      // and JSON.stringify emits scientific notation for very large numbers.
      price: MoneySerializer.toIntegerCOP(this.props.price),
      stock: this.props.stock,
      stockMin: this.props.stockMin,
      supplier: this.props.supplier,
      categoryId: this.props.categoryId,
      // Denormalized by the use case via `AlertReadModelPort`; defaults to
      // `false` for aggregates produced by `Product.create` /
      // `Product.rehydrate` without an explicit `withAlertFlag(...)` call.
      hasActiveAlert: this.alertFlag,
      description: this.props.description ?? null,
      createdAt: (this.props.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (this.props.updatedAt ?? new Date(0)).toISOString(),
    };
  }
}

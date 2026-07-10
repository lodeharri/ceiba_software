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
 */

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
  createdAt?: Date;
  updatedAt?: Date;
}

export class Product {
  private constructor(public readonly props: ProductProps) {}

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
    price: number;
    stock: number;
    stockMin: number;
    supplier: string;
    categoryId: string;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: this.props.id,
      sku: this.props.sku,
      name: this.props.name,
      price: this.props.price,
      stock: this.props.stock,
      stockMin: this.props.stockMin,
      supplier: this.props.supplier,
      categoryId: this.props.categoryId,
      createdAt: (this.props.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (this.props.updatedAt ?? new Date(0)).toISOString(),
    };
  }
}

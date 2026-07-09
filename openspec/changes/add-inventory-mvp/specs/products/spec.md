# Products Specification

## Purpose

The `products` bounded context owns the `Product` aggregate and the read-side
that powers inventory queries (RF-06). It exposes HTTP routes to register,
fetch, list, and update products. Stock mutation lives in `inventory`; alerts
and orders only consume the `ProductReadRepository`. Out of scope: soft
delete / archive, image upload, multi-currency pricing, multi-warehouse stock.

## Domain primitives

| Primitive                                | Owned here                       | Notes                                                                                    |
| ---------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `Product` (aggregate root)               | yes                              | id (UUID), name, sku, categoryId, price, stock, stockMin, supplier, createdAt, updatedAt |
| `SKU` (VO)                               | yes                              | `[A-Za-z0-9]{6,20}`, unique across products (BR-D5)                                      |
| `ProductName` (VO)                       | yes                              | 3-100 chars                                                                              |
| `SupplierName` (VO)                      | yes                              | 1-120 chars, non-empty                                                                   |
| `CategoryId` (FK)                        | yes                              | UUID referencing `categories.id` (D2 — lookup table)                                     |
| `Money` (price field)                    | referenced from `shared/spec.md` | Prisma `Decimal`, serialized as integer COP (D4)                                         |
| `Stock` / `StockMin` (non-negative ints) | yes                              | `stock >= 0`, `stockMin > 0`                                                             |

> Error envelope, pagination, and request-id live in [`shared/spec.md`](../shared/spec.md).
> `categories` lookup CRUD lives in [`categories/spec.md`](../categories/spec.md).
> The category FK is required at creation; the create call MUST validate it.

## Requirements

### Requirement: Create product with full validation

The system MUST accept `POST /api/v1/products` with
`{ name, sku, categoryId, price, stock, stockMin, supplier }` and MUST enforce
all of the following before persisting:

| Field        | Rule                                                 | Error on violation       |
| ------------ | ---------------------------------------------------- | ------------------------ |
| `name`       | 3-100 chars                                          | 400 `VALIDATION_ERROR`   |
| `sku`        | `[A-Za-z0-9]{6,20}`, unique                          | 409 `SKU_ALREADY_EXISTS` |
| `categoryId` | UUID, must reference an existing row in `categories` | 422 `CATEGORY_NOT_FOUND` |
| `price`      | integer COP `> 0`                                    | 400 `VALIDATION_ERROR`   |
| `stock`      | integer `>= 0` (default `0`)                         | 400 `VALIDATION_ERROR`   |
| `stockMin`   | integer `> 0`                                        | 400 `VALIDATION_ERROR`   |
| `supplier`   | 1-120 chars, non-empty                               | 400 `VALIDATION_ERROR`   |

On success the response is `201` with the persisted `Product` body including
its server-assigned UUID `id` and `createdAt` timestamp.

#### Scenario: Happy path

- GIVEN a valid body `name = "Agua Mineral 500ml"`, `sku = "BEB-001"`,
  `categoryId = <Bebidas id>`, `price = 1500`, `stock = 0`,
  `stockMin = 50`, `supplier = "Distribuidora Andina"`
- WHEN `POST /api/v1/products` is called
- THEN the response is `201` with the product body including `id` (UUID v4)
  and `createdAt` in ISO 8601

#### Scenario: Invalid name

- GIVEN a body with `name = "ab"` (length 2)
- WHEN the controller validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `name` listed in `details`

#### Scenario: Category does not exist

- GIVEN a body with `categoryId = "<random-uuid>"` not present in `categories`
- WHEN the use case validates the FK
- THEN the response is `422` with `code = "CATEGORY_NOT_FOUND"`

#### Scenario: SKU format invalid

- GIVEN a body with `sku = "ab"` (too short)
- WHEN Zod validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `sku` flagged

### Requirement: Duplicate SKU returns 409 SKU_ALREADY_EXISTS

The system MUST return `409` with `code = "SKU_ALREADY_EXISTS"` and a Spanish
message when a `POST /api/v1/products` body contains an `sku` that already
exists in the database; the existing product MUST NOT be updated (BR-D6 — no
silent upsert).

#### Scenario: SKU collision on create

- GIVEN an existing product with `sku = "BEB-001"`
- WHEN `POST /api/v1/products` is called with `sku = "BEB-001"`
- THEN the response is `409` with `code = "SKU_ALREADY_EXISTS"`,
  `message = "Ya existe un producto con el SKU 'BEB-001'."`, and
  `details = { sku: "BEB-001", existingProductId: "<id>" }`
- AND the existing row is unchanged

#### Scenario: SKU collision race

- GIVEN two concurrent `POST /api/v1/products` with the same `sku`
- WHEN both reach the database insert step
- THEN exactly one row is created and the loser receives `409`
  `SKU_ALREADY_EXISTS` (DB unique constraint + Prisma conflict mapping)

### Requirement: Price is stored as Decimal and serialized as integer COP

The system MUST persist `Product.price` as a Prisma `Decimal` column
(`@db.Decimal(12, 0)` for COP), MUST reject fractional currency at the DTO
layer with `400`, and MUST serialize the field as a JSON integer (no
decimals, no currency code) in every response (orchestrator-locked D4).

#### Scenario: Decimal round-trip

- GIVEN a product persisted with `price = 1500`
- WHEN the row is read and serialized
- THEN the JSON body has `price: 1500` (number, integer)

#### Scenario: Fractional price rejected

- GIVEN a request body with `price = 1500.50`
- WHEN Zod validates the DTO
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `price` flagged

### Requirement: List products with rich filters and pagination

The system MUST accept `GET /api/v1/products` with query params
`categoryId`, `supplier`, `hasActiveAlert` (`true` | `false`),
`minStock`, `maxStock`, `page`, `size` (defaults `1` and `20`, max `100`),
and MUST return the standard `Page<Product>` shape from `shared/spec.md`
with filters composed by AND semantics.

#### Scenario: No filters

- GIVEN a database with 6 reference products
- WHEN `GET /api/v1/products` is called without query params
- THEN the response is `200` with `items.length = 6`, `page = 1`,
  `size = 20`, `total = 6`, `hasMore = false`

#### Scenario: Filter by supplier

- GIVEN a product `BEB-001` from `Distribuidora Andina` and `LAC-001` from
  `Lácteos del Valle`
- WHEN `GET /api/v1/products?supplier=Lácteos del Valle` is called
- THEN the response contains `LAC-001` and `LAC-002` only

#### Scenario: Filter by categoryId

- GIVEN products spanning 4 categories
- WHEN `GET /api/v1/products?categoryId=<Bebidas id>` is called
- THEN the response contains only products in that category

#### Scenario: hasActiveAlert=true returns only alerted products

- GIVEN products `BEB-002` (no active alert) and `LAC-002` (active alert)
- WHEN `GET /api/v1/products?hasActiveAlert=true` is called
- THEN the response contains `LAC-002` only

#### Scenario: minStock + maxStock range

- GIVEN products with stock values `15, 30, 45, 80, 150, 200`
- WHEN `GET /api/v1/products?minStock=20&maxStock=100` is called
- THEN the response contains the rows whose stock is in `[20, 100]`

#### Scenario: Filters compose with AND

- GIVEN the seeded catalog
- WHEN `GET /api/v1/products?categoryId=<Bebidas id>&hasActiveAlert=true`
  is called
- THEN the response contains only products in that category AND with an
  active alert (intersection, not union)

#### Scenario: Pagination metadata

- GIVEN 45 products in the catalog
- WHEN `GET /api/v1/products?page=2&size=20` is called
- THEN the response has `page = 2`, `size = 20`, `total = 45`,
  `hasMore = true`, and `items.length = 20`

#### Scenario: Out-of-range size

- GIVEN `size = 500`
- WHEN the controller validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `size` flagged

### Requirement: Response includes server-assigned UUID id

The system MUST generate a UUID v4 for the product id at creation time and
MUST include it in every response (create, list items, get-by-id).

#### Scenario: id is UUID v4

- GIVEN a freshly created product
- WHEN the response body is inspected
- THEN `id` matches the regex
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`

### Requirement: Update product (name, supplier, price, stockMin, categoryId)

The system MUST accept `PATCH /api/v1/products/{id}` with any subset of
`{ name, supplier, price, stockMin, categoryId }` and MUST re-validate each
present field using the same rules as creation. The route MUST NOT accept
`sku`, `stock`, or `id` in the body.

#### Scenario: Update price only

- GIVEN a product with `price = 1500`
- WHEN `PATCH /api/v1/products/{id}` is called with `{ "price": 1700 }`
- THEN the response is `200` with the updated product
- AND `sku`, `stock`, `id`, `categoryId`, `name`, `stockMin`, `supplier`
  are unchanged

#### Scenario: Update blocked for unknown id

- GIVEN no row exists with id `<unknown>`
- WHEN `PATCH /api/v1/products/<unknown>` is called
- THEN the response is `404` with `code = "NOT_FOUND"`

#### Scenario: sku in body is rejected

- GIVEN a request body that includes `sku`
- WHEN Zod validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `sku` flagged as forbidden

### Requirement: Get one product by id

The system MUST accept `GET /api/v1/products/{id}` and MUST return `200`
with the full product body, or `404` with `code = "NOT_FOUND"` when the id
does not exist.

#### Scenario: Existing product

- GIVEN a product with id `<id>`
- WHEN `GET /api/v1/products/<id>` is called
- THEN the response is `200` with the full product body

#### Scenario: Missing product

- GIVEN no row with id `<missing>`
- WHEN `GET /api/v1/products/<missing>` is called
- THEN the response is `404` with `code = "NOT_FOUND"`

## Acceptance scenario summary

| Story                   | Pass condition                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| US-2 (register product) | 201 with body; invalid fields → 400; bad categoryId → 422; duplicate SKU → 409 |
| US-8 (query inventory)  | All six filters compose with AND; pagination returns stable shape              |
| Update                  | Only editable fields change; sku/stock/id untouched                            |

## Out of scope for this change

- Soft delete / archive (no `deletedAt` column).
- Image upload, barcode generation, multi-image gallery.
- Multi-warehouse stock (`stock` is a single integer).
- Supplier entity (a free-text string is enough for MVP).
- Bulk import (CSV / XLSX).
- Product variant model (size / color / pack).

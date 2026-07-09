# Inventory Specification

## Purpose

The `inventory` bounded context owns the `StockMovement` aggregate and the
stock-adjustment use case that appends to the immutable history (RF-02,
BR-6). It also surfaces a paginated read of the movement history for a given
product. The `Product.stock` field is mutated by inventory, but `Product`
itself is owned by the `products` BC: stock mutation happens through a
collaborator port inside the same Prisma transaction, never via a foreign-key
join from another BC. Out of scope: stock reservations, batch/expiry tracking,
serial numbers, multi-warehouse.

## Domain primitives

| Primitive                        | Owned here | Notes                                                                              |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `StockMovement` (aggregate root) | yes        | id (UUID), productId, type, quantity, reason, createdAt, createdBy                 |
| `MovementType` (enum)            | yes        | `ENTRADA` (+) or `SALIDA` (-) — sign derived (BR-D8)                               |
| `Quantity` (VO, signed)          | yes        | absolute magnitude `> 0`; sign comes from type (BR-D7)                             |
| `Reason` (VO)                    | yes        | 3-200 chars                                                                        |
| `StockSnapshot` (read model)     | yes        | `{ productId, currentStock, stockMin, computedAt }` returned in mutation responses |

> `Product.stock` and `Product.stockMin` live in the `products` schema; they
> are referenced here as the target of stock updates only.

> StockMovement is its OWN aggregate root (orchestrator-locked D1). No other
> BC references its rows; `alerts` and `orders` consume the published event
> payload, not the table.

## Requirements

### Requirement: StockMovement is its own aggregate root (no FK from outside)

The system MUST persist `StockMovement` rows in a dedicated table with no
inbound foreign keys from any other bounded context's table; the `productId`
column is a value reference (UUID, not a Prisma relation field exposed
outside the `inventory` infrastructure layer).

#### Scenario: No FK from products / alerts / orders

- GIVEN the Prisma schema
- WHEN inspected
- THEN `products`, `alerts`, and `orders` tables contain zero columns that
  reference `stock_movements.id`
- AND `stock_movements` has no `onDelete` cascade tied to any other BC's
  table

### Requirement: Append a StockMovement (ENTRADA increases, SALIDA decreases)

The system MUST accept `POST /api/v1/products/{productId}/movements` with
`{ type: "ENTRADA" | "SALIDA", quantity: int > 0, reason: string }` and MUST
append exactly one `StockMovement` row (BR-D7, BR-D8). The system MUST mutate
`Product.stock` by `+quantity` for `ENTRADA` and `-quantity` for `SALIDA`
inside the same Prisma transaction that inserts the movement.

#### Scenario: ENTRADA happy path

- GIVEN `Product` with `stock = 10`
- WHEN `POST /api/v1/products/<id>/movements` is called with
  `{ type: "ENTRADA", quantity: 5, reason: "Reposición proveedor" }`
- THEN exactly one `StockMovement` row is appended with
  `type = "ENTRADA", quantity = 5, reason = "Reposición proveedor"`
- AND `Product.stock` becomes `15`

#### Scenario: SALIDA happy path

- GIVEN `Product` with `stock = 10`
- WHEN the endpoint is called with
  `{ type: "SALIDA", quantity: 3, reason: "Venta mostrador" }`
- THEN one `StockMovement` row is appended
- AND `Product.stock` becomes `7`

#### Scenario: quantity = 0 rejected

- GIVEN a body with `quantity = 0`
- WHEN Zod validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `quantity` flagged (BR-D7)

#### Scenario: Unknown product

- GIVEN no `Product` with `productId = "<missing>"`
- WHEN the endpoint is called
- THEN the response is `404` with `code = "NOT_FOUND"`

### Requirement: SALIDA below zero is rejected with STOCK_WOULD_GO_NEGATIVE

The system MUST reject a `SALIDA` movement that would drop `Product.stock`
below `0` with `422`, `code = "STOCK_WOULD_GO_NEGATIVE"`, and a Spanish
message that names the short amount (BR-1).

#### Scenario: SALIDA short by 5

- GIVEN `Product` with `stock = 10`, `stockMin = 3`
- WHEN `POST /api/v1/products/<id>/movements` is called with
  `{ type: "SALIDA", quantity: 15, reason: "Venta" }`
- THEN the response is `422` with `code = "STOCK_WOULD_GO_NEGATIVE"`,
  `message = "Stock insuficiente: faltan 5 unidades para esta salida."`, and
  `details = { currentStock: 10, requested: 15, shortBy: 5 }`
- AND no `StockMovement` row is appended
- AND `Product.stock` remains `10`

#### Scenario: SALIDA exactly to zero

- GIVEN `Product` with `stock = 10`
- WHEN a SALIDA of `10` is requested
- THEN the movement is accepted and `Product.stock` becomes `0`
- AND a `StockBelowMinimum` event is published (see next requirement)

### Requirement: StockMovement rows are append-only (no update or delete)

The system MUST NOT expose any HTTP route that updates or deletes a
`StockMovement` row (BR-6). The repository MUST NOT expose `update` or
`delete` methods; only `append` and `listByProduct`.

#### Scenario: No edit endpoint

- GIVEN the API surface
- WHEN routes are enumerated
- THEN there is no `PUT`, `PATCH`, or `DELETE` route under
  `/api/v1/products/{id}/movements` or `/api/v1/movements`

#### Scenario: Repository interface

- GIVEN the `StockMovementRepository` port
- WHEN inspected
- THEN it exposes only `append(movement)` and
  `listByProduct(productId, page, size)`; no `update` or `delete` method

### Requirement: StockBelowMinimum event published after adjustment

After a successful `StockMovement`, when the new computed `stock <= stockMin`,
the system MUST publish a `StockBelowMinimum` event whose payload is
`{ productId, productName, currentStock, stockMin, occurredAt }` and whose
target is the `alerts` bounded context.

#### Scenario: Stock drops to min

- GIVEN `Product` with `stock = 31, stockMin = 30`
- WHEN a `SALIDA` of `1` is applied
- THEN the new `stock` is `30` (which is `<= stockMin`)
- AND the system publishes exactly one `StockBelowMinimum` event with
  `currentStock = 30` and `stockMin = 30`

#### Scenario: Stock above min

- GIVEN `Product` with `stock = 50, stockMin = 30`
- WHEN a `SALIDA` of `10` is applied
- THEN the new `stock` is `40`
- AND no `StockBelowMinimum` event is published

#### Scenario: ENTRADA can also trigger recovery path

- GIVEN `Product` with `stock = 30, stockMin = 30` (alert active)
- WHEN an `ENTRADA` of `5` is applied
- THEN the new `stock` is `35` (> stockMin)
- AND the published event is the same `StockBelowMinimum` shape? — NO, this
  case publishes the `StockRecovered` event consumed by alerts to close
  the active alert (see [`alerts/spec.md`](../alerts/spec.md))

### Requirement: Response includes the new computed stock (Q-S1)

The system MUST include the new computed `Product.stock` in every successful
`POST /movements` response under `stockAfter` and SHOULD include it in
`details` of error responses that reference stock (Q-S1).

#### Scenario: Successful ENTRADA response

- GIVEN a `SALIDA` of `5` on a product with `stock = 10`
- WHEN the endpoint responds `201`
- THEN the body contains `stockAfter: 5`

#### Scenario: Rejected SALIDA response

- GIVEN a `SALIDA` of `15` on a product with `stock = 10`
- WHEN the endpoint responds `422`
- THEN `details` contains `currentStock: 10, requested: 15, shortBy: 5`

### Requirement: Paginated movement history (latest 50 by default)

The system MUST accept `GET /api/v1/products/{productId}/movements` with
`page`, `size` query params (defaults `page = 1`, `size = 50`; orchestrator-
locked Q-P2) and MUST return the standard `Page<StockMovement>` shape with
movements ordered by `createdAt DESC`.

#### Scenario: Default page returns latest 50

- GIVEN a product with 120 movements
- WHEN `GET /api/v1/products/<id>/movements` is called without query params
- THEN the response has `page = 1`, `size = 50`, `items.length = 50`, and
  `items[0].createdAt >= items[49].createdAt` (descending)

#### Scenario: Second page

- GIVEN the same 120 movements
- WHEN `GET /api/v1/products/<id>/movements?page=2&size=50` is called
- THEN `items.length = 50`, `page = 2`, `total = 120`, `hasMore = false`

#### Scenario: Fewer rows than size

- GIVEN a product with 7 movements
- WHEN `GET /api/v1/products/<id>/movements` is called
- THEN `items.length = 7`, `size = 50`, `total = 7`, `hasMore = false`

#### Scenario: Unknown product

- GIVEN no product with `productId = "<missing>"`
- WHEN the endpoint is called
- THEN the response is `404` with `code = "NOT_FOUND"`

### Requirement: Sign of stock delta derives from MovementType

The system MUST compute the stock delta as `+quantity` for `ENTRADA` and
`-quantity` for `SALIDA` in a single helper owned by `StockMovement` (BR-D8);
no other code path may produce a `StockMovement` with a manually set sign.

#### Scenario: Single helper is the only writer

- GIVEN the `StockMovement` domain class
- WHEN its `applyTo(currentStock)` method is unit-tested
- THEN `ENTRADA(5).applyTo(10) === 15` and `SALIDA(5).applyTo(10) === 5`

#### Scenario: Negative quantity rejected at construction

- GIVEN a request with `quantity = -5`
- WHEN Zod validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"`; the
  `StockMovement` is never constructed

## Acceptance scenario summary

| Story                 | Pass condition                                                             |
| --------------------- | -------------------------------------------------------------------------- |
| US-3 (adjust stock)   | ENTRADA / SALIDA mutate stock; SALIDA below 0 → 422 BR-1; append-only BR-6 |
| Q-S1 (response shape) | Every movement response carries `stockAfter`                               |
| Q-P2 (history)        | Default page size 50, ordered by createdAt DESC                            |
| BR-6 (append-only)    | No PUT/PATCH/DELETE on movements; repo has no update/delete                |

## Out of scope for this change

- Stock reservations / holds (cart, transfer).
- Batch, lot, expiry, or serial tracking.
- Multi-warehouse stock split.
- Manual bulk import / CSV.
- Reordering thresholds or auto-replenishment rules.
- Edit / delete of historical movements (BR-6 forbids it permanently).

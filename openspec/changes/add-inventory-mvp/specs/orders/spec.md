# Orders Specification

## Purpose

The `orders` bounded context owns the `PurchaseOrder` aggregate and its full
lifecycle: creation (RF-04), approve / reject / receive transitions (RF-05),
and the atomic receive flow that increments stock AND closes any open alert
(BR-3, BR-D4). The supplier field is snapshotted at creation time and never
refreshed (orchestrator-locked Q-P3). The frontend exposes order creation as
a single form, not a wizard (orchestrator-locked Q-P1). Out of scope:
multi-line orders, partial receipts, supplier portal, payment, order history
audit beyond the state-machine fields.

## Domain primitives

| Primitive                                | Owned here | Notes                                                                                                          |
| ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `PurchaseOrder` (aggregate root)         | yes        | id (UUID), productId, quantity, status, supplierSnapshot, fromAlertId, reason, createdAt, updatedAt, createdBy |
| `OrderStatus` (enum)                     | yes        | `PENDIENTE` \| `APROBADA` \| `RECHAZADA` \| `RECIBIDA` (BR-5)                                                  |
| `SupplierSnapshot` (VO)                  | yes        | non-empty string copied from `Product.supplier` at creation (Q-P3)                                             |
| `OrderQuantity` (VO)                     | yes        | integer `>= 2 * Product.stockMin` at creation (BR-2)                                                           |
| `RejectionReason` (VO)                   | yes        | string `length >= 10` (BR-D2)                                                                                  |
| `FromAlertReference` (optional FK by id) | yes        | must reference an `ACTIVA` alert for the same productId when present                                           |

> State transitions live in [`shared/spec.md`](../shared/spec.md) for the
> error envelope only; the legal transitions live here in the
> `PurchaseOrder.transitionTo()` method.

## Requirements

### Requirement: Create order with supplier snapshot

The system MUST accept `POST /api/v1/orders` with
`{ productId: UUID, quantity: int, fromAlertId?: UUID }` and MUST return
`201` with the persisted order in `status = "PENDIENTE"` and a
`supplierSnapshot` field equal to `Product.supplier` at the moment of
creation (Q-P3 — never refreshed later).

#### Scenario: Manual creation

- GIVEN a product P with `supplier = "Distribuidora Andina"`,
  `stockMin = 30`
- WHEN `POST /api/v1/orders` is called with
  `{ productId: P, quantity: 60 }`
- THEN the response is `201` with
  `{ id, productId, quantity: 60, supplierSnapshot: "Distribuidora Andina", status: "PENDIENTE", fromAlertId: null, createdAt }`

#### Scenario: Creation from active alert

- GIVEN an active alert A for product P and P has `supplier = "SnacksCorp"`,
  `stockMin = 30`
- WHEN `POST /api/v1/orders` is called with
  `{ productId: P, quantity: 60, fromAlertId: A }`
- THEN the response is `201` and `fromAlertId` equals A

#### Scenario: Unknown product

- GIVEN no product with `productId = "<missing>"`
- WHEN `POST /api/v1/orders` is called
- THEN the response is `404` with `code = "PRODUCT_NOT_FOUND"`

### Requirement: Quantity must satisfy 2 * stockMin policy

The system MUST reject `POST /api/v1/orders` with `422` and
`code = "ORDER_QTY_BELOW_POLICY"` when `quantity < 2 * product.stockMin`
(BR-2). On success, the persisted order carries the requested `quantity`.

#### Scenario: Quantity below policy

- GIVEN a product P with `stockMin = 30`
- WHEN `POST /api/v1/orders` is called with
  `{ productId: P, quantity: 50 }` (50 < 60 = 2 × 30)
- THEN the response is `422` with `code = "ORDER_QTY_BELOW_POLICY"`,
  `message = "La cantidad solicitada debe ser al menos 2 veces el stock mínimo."`,
  `details = { requested: 50, minimum: 60, stockMin: 30 }`
- AND no order row is created

#### Scenario: Quantity exactly at policy

- GIVEN a product P with `stockMin = 30`
- WHEN `POST /api/v1/orders` is called with `{ productId: P, quantity: 60 }`
- THEN the order is created (`60 >= 60`)

#### Scenario: Quantity above policy

- GIVEN a product P with `stockMin = 25`
- WHEN `POST /api/v1/orders` is called with `{ productId: P, quantity: 100 }`
- THEN the order is created

### Requirement: fromAlertId must reference an ACTIVA alert for the same productId

The system MUST reject `POST /api/v1/orders` with `422` and
`code = "ALERT_NOT_ACTIVE"` when `fromAlertId` is provided and either (a)
the alert does not exist, (b) the alert's status is `RESUELTA`, or (c) the
alert's `productId` differs from the order's `productId`.

#### Scenario: Alert is RESUELTA

- GIVEN an alert A with `status = "RESUELTA"` for product P
- WHEN `POST /api/v1/orders` is called with
  `{ productId: P, quantity: 60, fromAlertId: A }`
- THEN the response is `422` with `code = "ALERT_NOT_ACTIVE"`

#### Scenario: Alert for a different product

- GIVEN an active alert A for product Q (not P)
- WHEN `POST /api/v1/orders` is called with
  `{ productId: P, quantity: 60, fromAlertId: A }`
- THEN the response is `422` with `code = "ALERT_PRODUCT_MISMATCH"`

#### Scenario: fromAlertId omitted

- GIVEN no `fromAlertId` in the body
- WHEN the order is created
- THEN the order's `fromAlertId` is `null` and creation succeeds (assuming
  the quantity policy holds)

### Requirement: Approve transitions PENDIENTE to APROBADA

The system MUST accept `POST /api/v1/orders/{id}/approve` and MUST transition
the order to `status = "APROBADA"` ONLY when the current status is
`PENDIENTE` (BR-D1, BR-5). For any other status the response is `409` with
`code = "ORDER_INVALID_TRANSITION"`.

#### Scenario: Happy approve

- GIVEN an order with `status = "PENDIENTE"`
- WHEN `POST /api/v1/orders/<id>/approve` is called
- THEN the response is `200` with the order in `status = "APROBADA"`
- AND `updatedAt` advances

#### Scenario: Approve already-approved order

- GIVEN an order with `status = "APROBADA"`
- WHEN the approve endpoint is called
- THEN the response is `409` with `code = "ORDER_INVALID_TRANSITION"` and
  `message = "La orden no se puede aprobar en su estado actual: APROBADA."`

### Requirement: Reject transitions PENDIENTE to RECHAZADA with reason

The system MUST accept `POST /api/v1/orders/{id}/reject` with
`{ reason: string }` and MUST transition the order to `status = "RECHAZADA"`
ONLY when (a) current status is `PENDIENTE` and (b) `reason.length >= 10`
(BR-D2). Short reason → `422 REASON_TOO_SHORT`; wrong status →
`409 ORDER_INVALID_TRANSITION`.

#### Scenario: Happy reject

- GIVEN an order with `status = "PENDIENTE"`
- WHEN the reject endpoint is called with
  `{ reason: "Proveedor sin stock hasta el lunes." }` (length 36)
- THEN the response is `200` with `status = "RECHAZADA"` and
  `reason` persisted

#### Scenario: Reason too short

- GIVEN an order with `status = "PENDIENTE"`
- WHEN the reject endpoint is called with `{ reason: "no" }`
- THEN the response is `422` with `code = "REASON_TOO_SHORT"`,
  `message = "El motivo debe tener al menos 10 caracteres."`,
  `details = { provided: 2, minimum: 10 }`
- AND the order stays `PENDIENTE`

#### Scenario: Reject already-rejected order

- GIVEN an order with `status = "RECHAZADA"`
- WHEN the reject endpoint is called
- THEN the response is `409` with `code = "ORDER_INVALID_TRANSITION"`

### Requirement: Receive transitions APROBADA to RECIBIDA (atomic side-effects)

The system MUST accept `POST /api/v1/orders/{id}/receive` and MUST transition
the order to `status = "RECIBIDA"` ONLY when the current status is `APROBADA`
(BR-D3). The system MUST execute the transition AND an `ENTRADA` stock
movement for the order's `quantity` AND `Product.stock` increment AND
closure of any `ACTIVA` alert for the same productId (when the new stock
strictly exceeds `stockMin`) inside ONE Prisma `$transaction` (BR-D4, design
pick Q-A3). On any failure the transaction rolls back: no partial state is
visible.

#### Scenario: Happy receive, stock rises, alert closes

- GIVEN an order O for product P with `quantity = 60`,
  `status = "APROBADA"`, snapshot supplier `SnacksCorp`
- AND P currently has `stock = 20, stockMin = 30` and an active alert
- WHEN `POST /api/v1/orders/<id>/receive` is called
- THEN the response is `200` with `status = "RECIBIDA"` and
  `stockAfter = 80`
- AND exactly one new `StockMovement` of type `ENTRADA` quantity `60`
  exists for P
- AND the active alert for P is now `status = "RESUELTA", resolvedAt = now`
- AND the `OrderReceived` event is emitted

#### Scenario: Happy receive, stock still below min, alert stays active

- GIVEN product P with `stock = 5, stockMin = 70`, an active alert, and
  order O with `quantity = 60, status = "APROBADA"`
- WHEN the receive endpoint is called
- THEN the response is `200` with `stockAfter = 65`
- AND a new `ENTRADA` movement of `60` exists for P
- AND the active alert for P stays `ACTIVA` (new `stock = 65` is NOT
  strictly above `stockMin = 70`, so the alert is not closed)

#### Scenario: Receive from PENDIENTE rejected

- GIVEN an order with `status = "PENDIENTE"`
- WHEN the receive endpoint is called
- THEN the response is `409` with `code = "ORDER_INVALID_TRANSITION"`
- AND no movement is written, no stock is mutated, no alert is changed

#### Scenario: Receive from RECHAZADA rejected

- GIVEN an order with `status = "RECHAZADA"`
- WHEN the receive endpoint is called
- THEN the response is `409` with `code = "ORDER_INVALID_TRANSITION"`

### Requirement: Order status follows the state machine (no skipping)

The system MUST reject any transition that is not in the table below with
`409` and `code = "ORDER_INVALID_TRANSITION"`.

| From        | To          | Endpoint                    |
| ----------- | ----------- | --------------------------- |
| `PENDIENTE` | `APROBADA`  | `POST /orders/{id}/approve` |
| `PENDIENTE` | `RECHAZADA` | `POST /orders/{id}/reject`  |
| `APROBADA`  | `RECIBIDA`  | `POST /orders/{id}/receive` |

All other transitions (including `PENDIENTE → RECIBIDA`, `RECHAZADA →
*`, `RECIBIDA → *`) MUST be rejected.

#### Scenario: Skip from PENDIENTE to RECIBIDA

- GIVEN an order with `status = "PENDIENTE"`
- WHEN `POST /api/v1/orders/<id>/receive` is called
- THEN the response is `409` with `code = "ORDER_INVALID_TRANSITION"`
- AND `message = "Solo se puede recibir una orden APROBADA."`

#### Scenario: Re-receive after RECIBIDA

- GIVEN an order with `status = "RECIBIDA"`
- WHEN `POST /api/v1/orders/<id>/receive` is called
- THEN the response is `409` with `code = "ORDER_INVALID_TRANSITION"`
- AND no duplicate movement is written

### Requirement: List orders with filters and pagination

The system MUST accept `GET /api/v1/orders?productId=&status=&page=&size=`
and MUST return the standard `Page<PurchaseOrder>` shape from
`shared/spec.md`, ordered by `createdAt DESC`.

#### Scenario: Filter by productId

- GIVEN 3 orders across 2 products
- WHEN `GET /api/v1/orders?productId=<P>` is called
- THEN the response contains only orders for P

#### Scenario: Filter by status

- GIVEN orders in mixed states
- WHEN `GET /api/v1/orders?status=APROBADA` is called
- THEN the response contains only `APROBADA` orders

#### Scenario: Pagination

- GIVEN 35 orders
- WHEN `GET /api/v1/orders?page=2&size=20` is called
- THEN the response has `page = 2, size = 20, total = 35, hasMore = false`
  and `items.length = 15`

#### Scenario: No filters

- GIVEN the same 35 orders
- WHEN `GET /api/v1/orders` is called
- THEN all 35 are returned across paginated responses

### Requirement: Get one order by id

The system MUST accept `GET /api/v1/orders/{id}` and MUST return `200`
with the full order body (including `supplierSnapshot`, `fromAlertId`,
and `reason` when `RECHAZADA`), or `404` with `code = "NOT_FOUND"` when
the id is unknown.

#### Scenario: RECHAZADA detail

- GIVEN an order with `status = "RECHAZADA"` and `reason = "Proveedor sin stock."`
- WHEN `GET /api/v1/orders/<id>` is called
- THEN the response includes `reason: "Proveedor sin stock."`

#### Scenario: Unknown id

- GIVEN no row with id `<missing>`
- WHEN `GET /api/v1/orders/<missing>` is called
- THEN the response is `404` with `code = "NOT_FOUND"`

### Requirement: Supplier snapshot is immutable after creation

The system MUST NOT refresh `PurchaseOrder.supplierSnapshot` from
`Product.supplier` at any later point in the order's lifecycle (Q-P3). The
field is a write-once value bound at `POST /orders` time.

#### Scenario: Supplier changes after creation

- GIVEN an order O created with `supplierSnapshot = "SnacksCorp"` while
  `Product.supplier = "SnacksCorp"`
- WHEN `Product.supplier` is later updated to `"NewSnacks"`
- THEN `GET /api/v1/orders/<id>` still returns
  `supplierSnapshot: "SnacksCorp"`

#### Scenario: Reject does NOT refresh supplier

- GIVEN order O with `supplierSnapshot = "SnacksCorp"`,
  `Product.supplier = "NewSnacks"`, `status = "PENDIENTE"`
- WHEN `POST /api/v1/orders/<id>/reject` is called
- THEN `supplierSnapshot` remains `"SnacksCorp"` after the transition

## Frontend contract note (Q-P1)

The `orders` SPA page MUST expose order creation as a single form (productId,
quantity, optional `fromAlertId` selection) — NOT a multi-step wizard
(orchestrator-locked Q-P1). This is a UI contract that lives in the design
phase; it is recorded here so the spec stays aligned with the locked answer.

## Acceptance scenario summary

| Story                             | Pass condition                                                             |
| --------------------------------- | -------------------------------------------------------------------------- |
| US-5 (create order)               | 201 in PENDIENTE; supplier snapshot taken at creation; qty policy enforced |
| US-6 (approve / reject / receive) | State machine enforced; receive atomic with stock + alert                  |
| US-7 (receive closes alert)       | Alert closure visible after next `GET /alerts?status=RESUELTA`             |
| Q-P3 (snapshot)                   | `supplierSnapshot` unchanged after `Product.supplier` mutates              |

## Out of scope for this change

- Multi-line orders (one product per order).
- Partial receipts (a single receive is all-or-nothing).
- Supplier entity (a free-text snapshot is enough for MVP).
- Email / Slack notifications on transitions.
- Edit of an order after creation (only the legal transitions are allowed).
- Currency on the order (price negotiation is out of scope; orders carry
  `quantity` and `supplierSnapshot` only).

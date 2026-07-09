# Alerts Specification

## Purpose

The `alerts` bounded context owns the `Alert` aggregate and its lifecycle
(RF-03). It subscribes to `StockBelowMinimum` and `StockRecovered` events
emitted by `inventory`, creates an `Alert` when stock falls at or below
`stockMin` and no active alert exists, and auto-closes the active alert when
stock rises strictly above `stockMin`. The `orders` BC consumes alerts as
optional context (`fromAlertId`) but never mutates them. Out of scope: manual
alert creation, alert snoozing, escalation chains, email/push notifications.

## Domain primitives

| Primitive                | Owned here | Notes                                               |
| ------------------------ | ---------- | --------------------------------------------------- |
| `Alert` (aggregate root) | yes        | id (UUID), productId, status, createdAt, resolvedAt |
| `AlertStatus` (enum)     | yes        | `ACTIVA` \| `RESUELTA`                              |
| `AlertType` (enum)       | yes        | `STOCK_BAJO` only for MVP                           |

> Uniqueness invariant (BR-4): at most one `ACTIVA` alert per `productId`,
> enforced by a partial unique index `(product_id) WHERE status = 'ACTIVA'`.

> Alerts react to events emitted by `inventory` (see
> [`inventory/spec.md`](../inventory/spec.md)). The transport mechanism
> (in-process bus vs direct collaborator) is a design-phase pick.

## Requirements

### Requirement: Alert auto-created from StockBelowMinimum event

When a `StockBelowMinimum` event arrives, the system MUST create exactly one
`Alert` with `status = "ACTIVA"` and `type = "STOCK_BAJO"` for the referenced
`productId` ONLY IF no `Alert` with `status = "ACTIVA"` exists for that
productId (BR-4 uniqueness).

#### Scenario: First crossing creates one alert

- GIVEN a product with no active alert and `stock = 30, stockMin = 30`
- WHEN a `StockBelowMinimum` event is received
- THEN exactly one `Alert` row exists for that productId with
  `status = "ACTIVA"`, `type = "STOCK_BAJO"`, `createdAt = now`

#### Scenario: Repeated event is a no-op

- GIVEN an `Alert` with `status = "ACTIVA"` for productId P
- WHEN a second `StockBelowMinimum` event arrives for P
- THEN no new alert is created
- AND the existing alert is unchanged

#### Scenario: Concurrency: two simultaneous events

- GIVEN two `StockBelowMinimum` events for the same productId arriving
  concurrently
- WHEN both reach the create step
- THEN exactly one row exists after the race resolves
- AND the database partial unique index is the binding constraint
  (`(product_id) WHERE status = 'ACTIVA'`)

### Requirement: Alert auto-closes on stock recovery

When a stock adjustment raises `stock` strictly above `stockMin` and an
`Alert` with `status = "ACTIVA"` exists for that productId, the system MUST
set that alert to `status = "RESUELTA"` and `resolvedAt = now`. The trigger
is the post-event `StockRecovered` signal published by `inventory`
(BR-3 + RF-03).

#### Scenario: Recovery closes active alert

- GIVEN product P with `stock = 30, stockMin = 30` and an `ACTIVA` alert
- WHEN an ENTRADA of `5` is applied and the post-event `stock = 35`
- THEN the active alert transitions to `status = "RESUELTA"`,
  `resolvedAt = now`, and the row remains visible in `GET /alerts` with
  the resolution timestamp

#### Scenario: No-op when no active alert exists

- GIVEN product P with no active alert and `stock = 100, stockMin = 30`
- WHEN an ENTRADA of `10` is applied
- THEN no alert is created and no alert is modified

#### Scenario: Recovery after order receive (cross-BC)

- GIVEN product P with `stock = 25, stockMin = 30` and an `ACTIVA` alert
- WHEN a `POST /api/v1/orders/{id}/receive` is processed that brings
  `stock` to `65`
- THEN the active alert closes inside the same Prisma transaction as the
  stock update (no half-state visible to readers)

### Requirement: List alerts by status with pagination

The system MUST accept `GET /api/v1/alerts?status=ACTIVA|RESUELTA&page=&size=`
and MUST return the standard `Page<Alert>` shape from `shared/spec.md`,
ordered by `createdAt DESC`.

#### Scenario: Filter ACTIVA

- GIVEN 2 active alerts and 5 resolved alerts
- WHEN `GET /api/v1/alerts?status=ACTIVA` is called
- THEN the response contains 2 items

#### Scenario: Filter RESUELTA

- GIVEN the same database
- WHEN `GET /api/v1/alerts?status=RESUELTA` is called
- THEN the response contains 5 items

#### Scenario: Default status omitted

- GIVEN both active and resolved alerts exist
- WHEN `GET /api/v1/alerts` is called without `status`
- THEN the response contains both, ordered by `createdAt DESC`

#### Scenario: Pagination

- GIVEN 73 alerts total
- WHEN `GET /api/v1/alerts?status=ACTIVA&page=2&size=20` is called
- THEN the response has `page = 2, size = 20, total = <active count>,
hasMore = (total > 40)`

#### Scenario: Invalid status

- GIVEN `status = "WAT"`
- WHEN Zod validates the query
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `status` flagged

### Requirement: Get one alert by id with product snapshot

The system MUST accept `GET /api/v1/alerts/{id}` and MUST return `200` with
the alert body AND a `product` snapshot (id, name, sku, currentStock,
stockMin) AND, when `status = "RESUELTA"`, a `resolvedAt` timestamp; on
unknown id the response is `404` with `code = "NOT_FOUND"`.

#### Scenario: ACTIVA alert detail

- GIVEN an active alert for product P
- WHEN `GET /api/v1/alerts/<id>` is called
- THEN the response is `200` with
  `{ id, productId, status: "ACTIVA", type: "STOCK_BAJO", createdAt, product: { id, name, sku, currentStock, stockMin } }`

#### Scenario: RESUELTA alert detail

- GIVEN a resolved alert for product P
- WHEN `GET /api/v1/alerts/<id>` is called
- THEN the response includes `status: "RESUELTA"` and `resolvedAt`

#### Scenario: Unknown id

- GIVEN no alert with id `<missing>`
- WHEN `GET /api/v1/alerts/<missing>` is called
- THEN the response is `404` with `code = "NOT_FOUND"`

### Requirement: At most one ACTIVA alert per productId (DB invariant)

The system MUST enforce the BR-4 uniqueness invariant at the database layer
via a partial unique index on `(product_id) WHERE status = 'ACTIVA'`, and
MUST surface a violation as `409` with `code = "ALERT_ALREADY_ACTIVE"`.

#### Scenario: Partial unique index present

- GIVEN the Prisma migration
- WHEN inspected
- THEN the `alerts` table has an index
  `CREATE UNIQUE INDEX alerts_one_active_per_product ON alerts (product_id) WHERE status = 'ACTIVA'`

#### Scenario: Direct insert attempt blocked

- GIVEN a row with `(product_id = P, status = "ACTIVA")` already exists
- WHEN a second `INSERT` attempts `(product_id = P, status = "ACTIVA")`
- THEN the DB rejects with `unique_violation` and the application maps it
  to `409 ALERT_ALREADY_ACTIVE`

### Requirement: Alerts never mutated by orders or products BCs

The system MUST NOT expose any HTTP route on the `alerts-lambda` that allows
manual creation, edit, or deletion of alerts. The only mutation paths are
the event handlers for `StockBelowMinimum` (open) and `StockRecovered`
(close), plus the receive-order side-effect (close, executed inside the
orders Prisma transaction).

#### Scenario: No create endpoint

- GIVEN the API surface
- WHEN routes are enumerated
- THEN there is no `POST /api/v1/alerts`, no `PUT/PATCH/DELETE` under
  `/api/v1/alerts/{id}`

## Acceptance scenario summary

| Story                   | Pass condition                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- |
| US-4 (low-stock alerts) | First crossing opens one alert; repeated event is a no-op; recovery closes        |
| BR-3 (auto-close)       | Post-event stock > stockMin with active alert → resolved with timestamp           |
| BR-4 (uniqueness)       | Partial unique index blocks two `ACTIVA` rows for the same productId              |
| Read API                | List by status with pagination; detail includes product snapshot and `resolvedAt` |

## Out of scope for this change

- Manual alert creation, edit, or dismissal.
- Notification channels (email, SMS, push, webhook).
- Alert severity levels beyond `STOCK_BAJO`.
- Snoozing, escalation, on-call rotations.
- Cross-product alerts or composite rules.
- Time-based forecasting ("will run out by Friday").

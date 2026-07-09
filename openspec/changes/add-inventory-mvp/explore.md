# Exploration — add-inventory-mvp

A map of the territory before the proposal phase writes the PRD. Decision-oriented, scoped, and intentionally incomplete: this note makes no implementation choices and writes no code.

---

## Quick path (TL;DR)

- The repo is **greenfield**: only `porject.md`, `openspec/{AGENTS.md,config.yaml}`, `.atl/skill-registry.md`, and `.gitignore` exist. There is no `package.json`, no `pnpm-workspace.yaml`, no `packages/`, no `infra/`, no CI.
- The product is a CRUD-ish inventory MVP with **five bounded contexts**: `auth`, `products`, `inventory`, `alerts`, `orders`. The auth BC is user-added (not in `porject.md`) and is already locked in `openspec/config.yaml`.
- The interesting business seams are **not** CRUD; they are three cross-BC reactions:
  1. A `SALIDA` stock movement that drops stock at/below `stock_min` opens an alert.
  2. Receiving a `PurchaseOrder` increments stock and closes the alert if stock rises above `stock_min`.
  3. Order qty must be `>= 2 * stock_min` of the product.
- Most "interesting" risks are operational, not domain-shaped: Prisma cold start on Lambda, RDS t3.micro memory pressure, JWT secret rotation, and concurrent stock adjustments.
- Several architectural questions are intentionally **left open for the proposal phase** (most importantly: is `StockMovement` an aggregate of `Product` or its own aggregate).

---

## 1. Repo snapshot

### 1.1 What exists today (paths only)

| Path                     | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `porject.md`             | Source of truth: RF-01..RF-06, business rules, reference data |
| `openspec/AGENTS.md`     | Repo-wide conventions (layering, naming, commit/PR rules)     |
| `openspec/config.yaml`   | Locked stack + SDD conventions + bounded contexts             |
| `.atl/skill-registry.md` | Delegator-only skill index (not read by normal agents)        |
| `.gitignore`             | Excludes `.atl/`                                              |

### 1.2 What is missing (every package, infra, workflows, env files)

| Layer         | Missing artifact                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo root | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, `.nvmrc`, `.editorconfig`, `.env`, `.env.example`                                                                                                   |
| Backend       | `packages/backend/{package.json, tsconfig.json, vitest.config.ts, prisma/schema.prisma, src/{auth,products,inventory,alerts,orders}/}`                                                                                     |
| Frontend      | `packages/frontend/{package.json, vite.config.ts, tailwind.config.ts, tsconfig.json, index.html, src/{main.ts, App.vue, router/, stores/, services/, i18n/, components/{atoms,molecules,organisms}/, templates/, pages/}}` |
| Shared        | `packages/shared/{package.json, tsconfig.json, src/index.ts}` (zod schemas, DTOs, error types, domain primitives)                                                                                                          |
| Infra         | `packages/infra/{package.json, tsconfig.json, cdk.json, src/app.ts, src/stacks/{ApiStack,DatabaseStack,FrontendStack,AuthStack}.ts, src/constructs/}`                                                                      |
| Database      | Prisma schema, initial migration, seed script (admin user + reference products)                                                                                                                                            |
| CI            | `.github/workflows/{ci.yml, deploy-dev.yml, deploy-prod.yml}`, OIDC role, dev/prod environment configs                                                                                                                     |
| Observability | CloudWatch log groups, alarms, dashboards wiring (scaffolded by CDK but thresholds TBD)                                                                                                                                    |
| Docs          | `README.md`, `packages/*/README.md`, ADR folder                                                                                                                                                                            |

---

## 2. Requirements map (RF-01..RF-06 → bounded contexts)

| RF    | Title                         | Primary BC                                            | Primary aggregate                              | Key ports the BC exposes                                                                                                        | Cross-BC deps                                                                                |
| ----- | ----------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| RF-01 | Registro de Productos         | `products`                                            | `Product`                                      | `ProductRepository` (write), `ProductReadRepository` (filter by categoria/proveedor/stock-range/has-active-alert)               | (none on creation)                                                                           |
| RF-02 | Ajuste de Inventario          | `inventory`                                           | `Product` (mutated) + `StockMovement` (append) | `StockMovementRepository` (append-only), `ProductStockGate` (read current stock, lock or guard negative)                        | depends on `products.ProductReadRepository` for current stock                                |
| RF-03 | Alertas de Stock Bajo         | `alerts`                                              | `Alert`                                        | `AlertRepository`, `AlertSubscriptionPort` (consume stock-below-min events), `AlertClosurePort` (publish alert-resolved events) | depends on `products.ProductReadRepository` for current stock and `stock_min`                |
| RF-04 | Generación de Órdenes         | `orders`                                              | `PurchaseOrder`                                | `PurchaseOrderRepository`, `OrderPolicyPort` (read product's `stock_min` for qty rule)                                          | depends on `products` (for `stock_min`); optional dep on `alerts` (create from alert)        |
| RF-05 | Gestión de Estados de Órdenes | `orders`                                              | `PurchaseOrder`                                | Same as RF-04 + `OrderTransitionPort` (publishes domain events: `OrderApproved`, `OrderRejected`, `OrderReceived`)              | `OrderReceived` event triggers `inventory` (stock increment) + `alerts` (close if above min) |
| RF-06 | Consulta de Inventario        | `products` (+ `inventory` for the stock-range filter) | read model                                     | `ProductReadRepository` (rich filters)                                                                                          | depends on `alerts` if filter is "has active alert"                                          |

### 2.1 Dependency direction

```
auth  ──>  all BCs  (Bearer JWT validated by per-Lambda middleware)
products  ──>  inventory  (inventory reads current stock from products)
products  ──>  alerts    (alerts reads stock + stock_min from products)
products  ──>  orders    (orders reads stock_min from products)
alerts    ──>  orders    (orders references an alert as creation source — optional)
orders  ──>  inventory  (OrderReceived triggers stock increment)
orders  ──>  alerts     (OrderReceived can close alert atomically)
```

No circular dependencies. `auth` is foundational but its ports (`UserRepository`, `PasswordHasherPort`, `TokenIssuerPort`, `TokenValidatorPort`) are independent of the other BCs.

---

## 3. Domain primitives

### 3.1 Entities / aggregates

| Entity          | BC        | Role                                                                                                | Identity                                             |
| --------------- | --------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `Product`       | products  | Aggregate root                                                                                      | DB id (UUID)                                         |
| `StockMovement` | inventory | Aggregate **or** entity inside `Product` (decision deferred to design phase — see open question Q1) | DB id                                                |
| `Alert`         | alerts    | Aggregate root                                                                                      | DB id; uniqueness: only one `ACTIVA` per `productId` |
| `PurchaseOrder` | orders    | Aggregate root                                                                                      | DB id                                                |
| `User`          | auth      | Aggregate root                                                                                      | DB id; uniqueness: `email`, `username`               |

### 3.2 Value objects (concrete, inferred from RF text)

| Value object                       | Invariants                                            | Notes                                                                          |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `SKU`                              | alphanumeric, 6-20 chars, unique across products      | Validated at creation; uniqueness enforced at DB                               |
| `Money`                            | `amount > 0`, currency code                           | Currency assumed single (COP implied by `$` format); spec phase picks currency |
| `Quantity`                         | non-negative integer; for movements `> 0`             | Used in `StockMovement` and `PurchaseOrder`                                    |
| `AlertStatus`                      | enum `ACTIVA \| RESUELTA`                             | Drives uniqueness rule                                                         |
| `OrderStatus`                      | enum `PENDIENTE \| APROBADA \| RECHAZADA \| RECIBIDA` | Drives transition rules                                                        |
| `MovementType`                     | enum `ENTRADA \| SALIDA`                              | Sign of stock delta is derived from this                                       |
| `CategoryName`                     | string (or FK to categories table — see Q4)           | Lookup table vs enum string is open                                            |
| `Email`, `Username`, `Role` (auth) | standard formats, default role `admin`                | Locked in `config.yaml`                                                        |

### 3.3 Domain events worth recording

| Event               | Source BC                 | Consumers                                                 | Trigger                                                  |
| ------------------- | ------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `ProductCreated`    | products                  | (none internal; future audit/AI)                          | POST product                                             |
| `StockAdjusted`     | inventory                 | alerts (subscribes)                                       | any `StockMovement` applied                              |
| `StockBelowMinimum` | inventory or alerts (TBD) | alerts creates an `Alert`                                 | post-adjustment stock `<= stock_min` and no active alert |
| `AlertResolved`     | alerts                    | (audit)                                                   | active alert closed because stock rose above `stock_min` |
| `OrderCreated`      | orders                    | (audit)                                                   | POST order                                               |
| `OrderApproved`     | orders                    | (audit)                                                   | `PENDIENTE -> APROBADA`                                  |
| `OrderRejected`     | orders                    | (audit)                                                   | `PENDIENTE -> RECHAZADA` with reason                     |
| `OrderReceived`     | orders                    | inventory (subscribe), alerts (subscribe if alert active) | `APROBADA -> RECIBIDA`                                   |

> **Decision deferred**: whether `StockBelowMinimum` is published by `inventory` and `alerts` subscribes, or whether `alerts` is a direct collaborator of `inventory` is a design-phase call.

---

## 4. Business rule inventory

### 4.1 The six from `porject.md`

| ID   | Rule (one-line)                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| BR-1 | A SALIDA movement that would drop stock below 0 must be rejected with a clear message stating how much is short.               |
| BR-2 | A `PurchaseOrder` qty must be `>= 2 * product.stock_min`.                                                                      |
| BR-3 | When a `PurchaseOrder` is received and stock rises above `stock_min`, the associated alert closes automatically.               |
| BR-4 | At most one `ACTIVA` alert per product at any time.                                                                            |
| BR-5 | Only `PENDIENTE` orders can transition to `APROBADA` (approve) or `RECHAZADA` (reject). `RECIBIDA` is reached from `APROBADA`. |
| BR-6 | `StockMovement` rows are append-only; never updated, never deleted.                                                            |

### 4.2 Derived rules noticed while mapping

| ID    | Rule                                                                                                   | Notes                                                       |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| BR-D1 | Approve requires order status == `PENDIENTE`                                                           | Restatement of BR-5 for the approve transition specifically |
| BR-D2 | Reject requires order status == `PENDIENTE` AND rejection reason length `>= 10`                        | RF-05 explicit                                              |
| BR-D3 | Receive requires order status == `APROBADA`                                                            | RF-05 explicit                                              |
| BR-D4 | Receive atomically increments stock AND closes the alert when applicable                               | BR-3 + RF-05; transactionality is the spec/design question  |
| BR-D5 | SKU is unique across all products                                                                      | Schema constraint; surfaced as 409 on conflict              |
| BR-D6 | Creating a product with an already-existing SKU does NOT update; it returns 409 conflict               | Idempotency stance (see Q3)                                 |
| BR-D7 | StockMovement quantity must be `> 0`                                                                   | A 0-qty movement is meaningless and likely a UI bug         |
| BR-D8 | `MovementType` drives the sign of stock delta: `ENTRADA -> +qty`, `SALIDA -> -qty`                     | Single source of truth: the entity itself                   |
| BR-D9 | All domain writes must validate the entity invariant in code BEFORE touching the DB (defence in depth) | Standard hexagonal hygiene                                  |

---

## 5. Heuristic happy path

Numbered sequence; no concurrency, no errors, single user.

```
1.  POST /api/v1/auth/login              (admin user via seed)
2.  GET  /api/v1/products                (browse inventory, filter optional)
3.  POST /api/v1/products                (create a Product)
4.  POST /api/v1/products/{id}/movements (ENTRADA x 100 -> initial stock)
5.  POST /api/v1/products/{id}/movements (SALIDA x 80 -> stock drops to 20, below min 30)
                                          -> domain event StockBelowMinimum
                                          -> alerts BC creates Alert (ACTIVA)
6.  GET  /api/v1/alerts?status=ACTIVA    (operator sees the alert)
7.  POST /api/v1/orders                  (fromAlertId=alert-1, qty=60)
                                          -> validates qty >= 2 * stock_min (60 >= 60 OK)
                                          -> order created in PENDIENTE
8.  POST /api/v1/orders/{id}/approve    (PENDIENTE -> APROBADA)
9.  POST /api/v1/orders/{id}/receive    (APROBADA -> RECIBIDA)
                                          -> inventory BC: stock += qty (now 80, above min)
                                          -> alerts BC: alert status -> RESUELTA
                                          -> publish OrderReceived, AlertResolved events
10. GET  /api/v1/products/{id}           (stock now 80, no active alert)
```

---

## 6. Edge cases & open questions for the proposal phase

| #   | Question                                                                                                                       | Why it matters                                                                                                                                                     | Who should weigh in                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Q1  | Is `StockMovement` its own aggregate or an entity owned by `Product`?                                                          | Drives whether stock adjustments and product reads need cross-aggregate transactions. RF-02 + BR-6 suggest strong "append-only history" semantics; design decides. | design phase                             |
| Q2  | How do two simultaneous `SALIDA` movements race? Last-writer-wins? Pessimistic lock on product row? Optimistic version column? | Stock is the single most contended invariant. BR-1 violation = bug.                                                                                                | design phase + risk R-2                  |
| Q3  | What's the idempotency stance on `POST /products` when the SKU exists? 409 conflict, or upsert-on-SKU?                         | RF-01 says SKU is "único" but doesn't say what API should do on collision. Recommend 409 (safer for an inventory system).                                          | proposal phase                           |
| Q4  | `Categoria`: enum string vs lookup table (FK)?                                                                                 | Lookup table lets ops add new categories without migrations. Tradeoff: extra CRUD surface and seed burden. Spec phase decides.                                     | proposal / design                        |
| Q5  | Login: rate-limit / lockout policy?                                                                                            | `porject.md` says nothing; `config.yaml` mentions `bcrypt` only. Recommends at least 5 attempts per 15 min per IP+username.                                        | proposal phase                           |
| Q6  | Order creation UI: wizard vs separate screens?                                                                                 | RF-04 accepts manual creation OR from alert. A wizard reduces decisions but adds state. Frontend UX, not backend.                                                  | design phase (out of scope for proposal) |
| Q7  | Currency: which? `porject.md` shows `$` ambiguous (could be COP, USD, ARS). Locking requires analyst input.                    | Affects `Money` VO and i18n formatting.                                                                                                                            | proposal phase                           |
| Q8  | "Receive order increments stock automatically AND closes alert" — single DB transaction or two-phase?                          | Affects consistency guarantees and how we recover from partial failures.                                                                                           | design phase                             |
| Q9  | Should the API return the new computed `stock` in every response for `POST /movements` and `POST /orders/{id}/receive`?        | Saves the frontend a round-trip. Cheap to add, expensive to remove.                                                                                                | spec phase                               |
| Q10 | Does the reference data (6 productos) ship as a dev-only seed or as a fixture of the prod schema?                              | Seed = repeatable demo + e2e fixtures. Prod = always-reseeded on deploy is dangerous.                                                                              | proposal phase                           |
| Q11 | `MovementType`: ENUM column or VARCHAR-with-check?                                                                             | DB portability for tests (SQLite vs Postgres) and migration ergonomics.                                                                                            | design phase                             |

---

## 7. Initial admin seed strategy (carry forward)

Three options evaluated against cost, reproducibility, and risk:

| Option                                                           | Mechanism                                                             | Pros                                                                | Cons                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A. CDK `CustomResource` on deploy**                            | A Lambda-backed custom resource runs the seed on stack create/update  | Self-contained infra; runs every deploy                             | Slower deploys; non-idempotent if not written carefully; ties seed to infra lifecycle |
| **B. `prisma db seed` via one-shot Lambda invoked by a CI step** | A seed Lambda runs `tsx prisma/seed.ts` after `prisma migrate deploy` | Idempotent (use `upsert`); runs in CI; matches local `pnpm db:seed` | Requires CI wiring; one more moving part                                              |
| **C. Manual SQL via CLI**                                        | Dev runs `psql` with a checked-in SQL file                            | Zero infra                                                          | Doesn't scale, no repro on fresh envs                                                 |

**Recommendation: B (prisma seed via one-shot Lambda in CI) for non-prod; C reserved for ops-only prod seeding.**

Why:

- The stack config already defines `cdk-custom-resource-prisma-migrate-deploy` (see `openspec/config.yaml → database.migrations_strategy`). The same pattern fits seed elegantly.
- Seed = `admin` user with a known bcrypt hash + the 6 reference `Product` rows. Both are natural `upsert` calls keyed on stable identifiers (email / SKU).
- Keeps infra-only changes (CDK) separate from data changes (seed). That is the right seam.
- Manual CLI stays as the fallback for smoke-testing in dev.

---

## 8. Risk register (identification only — no severity yet)

| ID   | Risk                                                                              | Where it bites                                                                            |
| ---- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R-1  | Prisma + pgvector cold start on Lambda                                            | Adds ~1-3 s to first-request latency after idle; multiplies with 5 lambdas                |
| R-2  | Concurrent `SALIDA` movements on the same product could double-spend stock        | Race condition violates BR-1                                                              |
| R-3  | JWT HS256 with a long-lived secret — rotation is painful; compromise is unbounded | All protected endpoints                                                                   |
| R-4  | RDS `db.t3.micro` under bursty connections (concurrent logins + adjustments)      | OOM kills + reboot; affects dev/staging too                                               |
| R-5  | API Gateway HTTP v2 cold-start on first request after idle                        | Same UX hit as R-1, edge-side                                                             |
| R-6  | Seed job runs before migration completes (racing order in CI)                     | First deploy into a fresh env                                                             |
| R-7  | Single `users` table, default role `admin`, no RBAC                               | Anyone who logs in can do anything; `porject.md` has no roles, only one user type implied |
| R-8  | `Money` rounding lost in JSON serialization                                       | JavaScript floats overstate rounding; needs explicit `decimal.js` or Prisma `Decimal`     |
| R-9  | `pgvector` extension availability on `db.t3.micro`                                | Some free-tier RDS engines disable extensions; needs explicit `rds.extensions` in CDK     |
| R-10 | Reference data drift between local (docker-compose pgvector) and CI/Prod Postgres | "Works locally, fails in prod"                                                            |

---

## 9. Prior art / library proposals (naming only — no evaluation)

| Concern                      | Candidates                                                      | Notes                                                                            |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Password hashing             | `bcrypt` vs `argon2`                                            | `config.yaml` already locks `bcrypt`. Confirm in spec.                           |
| JWT signing                  | `jsonwebtoken` vs `jose`                                        | `jose` is the more modern, audited choice; `jsonwebtoken` is the legacy default. |
| Runtime validation           | `zod`                                                           | Already locked.                                                                  |
| OpenAPI gen                  | `@asteasolutions/zod-to-openapi`                                | Already locked.                                                                  |
| ORM                          | `@prisma/client`                                                | Already locked.                                                                  |
| Structured logging           | `pino` vs `winston`                                             | `pino` is faster and has better Lambda output; `winston` has more transports.    |
| Lambda bundler               | `@aws-cdk/aws-lambda-nodejs` vs pure CDK + standalone `esbuild` | Locked to the former. Confirm `externals` (Prisma engine) handling.              |
| Hashing for idempotency keys | `crypto.randomUUID` + DB unique index                           | RFC 4122 v4; built-in, no deps                                                   |
| Decimal money                | Prisma `Decimal` field + `decimal.js` at the boundary           | Avoid `number` for currency                                                      |
| Frontend HTTP                | `ofetch`                                                        | Already locked                                                                   |
| Frontend state               | `pinia`                                                         | Already locked                                                                   |
| Frontend i18n                | `vue-i18n`                                                      | Not explicitly locked in config; assumed                                         |

---

## 10. What this exploration DOES NOT decide

- API route shapes, HTTP status code maps, exact error envelope. (Spec phase.)
- Component layout, Atomic Design placement, page route map. (Design phase.)
- File/PR boundary, commit cadence, branch strategy. (Tasks + Apply phases.)
- Specific bcrypt cost factor, JWT exact expiry clock, refresh-token policy. (Spec phase.)
- CloudWatch alarms, log retention, dashboard panels. (Infra design.)
- CI matrix (Node version, cache, parallel jobs). (Infra design.)
- Anything about delivery/PR shape. (Out of scope per orchestrator.)

---

## Next step

Hand this exploration to the `sdd-propose` phase. The proposal will:

1. Decide Q1 (StockMovement aggregate boundary), Q4 (Category shape), Q7 (currency).
2. Pick option B for the admin seed (Q10 in the proposal).
3. Pick `argon2` vs `bcrypt` and `jose` vs `jsonwebtoken` from §9.
4. Surface a UI question round for product/order flows before locking the spec.

The proposal must not invent requirements beyond RF-01..RF-06 + the user-added auth BC.

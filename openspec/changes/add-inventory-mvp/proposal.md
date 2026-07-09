# Proposal: `add-inventory-mvp` — MercadoExpress inventory MVP

**Status:** Draft for user review · **Phase:** sdd-propose · **Change folder:** `openspec/changes/add-inventory-mvp/`

This proposal locks the product, scope, business rules, and architecture for the MercadoExpress inventory system. It restates RF-01..RF-06 from `porject.md`, codifies the 15 business rules (6 source + 9 derived), and binds seven user-shaping decisions that the orchestrator has already locked. The spec, design, and tasks phases consume this document as input.

---

## Quick path (TL;DR)

- **What:** REST API + Vue 3 SPA that registers products, adjusts stock with an immutable history, raises and auto-closes low-stock alerts, and drives a purchase-order lifecycle, behind JWT login.
- **How:** Five Lambdas behind API Gateway HTTP v2 (one per BC: auth, products, inventory, alerts, orders), Prisma on RDS Postgres `db.t3.micro` + pgvector, Vue 3 + Tailwind + Atomic Design, deployed via CDK with OIDC-backed GitHub Actions.
- **Where it lives:** `packages/backend`, `packages/frontend`, `packages/infra`, `packages/shared` (pnpm workspaces, monorepo).
- **Locked by orchestrator (do NOT overturn without hard evidence):** StockMovement is its own aggregate (D1); Categoria is a lookup table (D2); login rate limit 5/15 min per IP+username (D3); currency COP integer (D4); seed via CI Lambda + `prisma db seed` (D5); bcrypt cost 10 (D6); JWT via `jose` (D7).
- **Next step:** Spec phase writes HTTP routes + status maps; Design phase picks the cross-BC reaction mechanism (events vs direct call) and the concurrency strategy for stock adjustments.

---

## 1. Intent

MercadoExpress replaces a manual spreadsheet inventory workflow for a Colombian retail chain with a tested, deployable web system. Operators register products (RF-01), record stock movements with an append-only history (RF-02 + BR-6), receive automatic low-stock alerts (RF-03) that close themselves when stock recovers (BR-3), generate purchase orders against an explicit minimum-quantity policy (RF-04 + BR-2), and drive orders through approve → receive (RF-05) — which atomically increments stock and closes any open alert. Inventory is queryable by category, supplier, alert state, and stock range (RF-06). All endpoints are guarded by a JWT issued by a `POST /api/v1/auth/login` route (user-added BC, not in `porject.md` but locked in `openspec/config.yaml → auth`). Acceptance is automatic: every business rule maps to a Playwright e2e scenario plus unit tests, with the backend `domain/` and `application/` layers at ≥80% coverage.

---

## 2. Scope

### 2.1 In scope (ship in this change)

| Area                                                             | Coverage                  | Source                             |
| ---------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| Product CRUD + SKU uniqueness                                    | RF-01, BR-5 (schema)      | `porject.md`                       |
| Stock adjustments with append-only movement history              | RF-02, BR-1, BR-6         | `porject.md`                       |
| Low-stock alerts (create + auto-close)                           | RF-03, BR-3, BR-4         | `porject.md`                       |
| Purchase order creation (manual + from alert)                    | RF-04, BR-2               | `porject.md`                       |
| Order lifecycle (approve / reject / receive)                     | RF-05, BR-5 (transitions) | `porject.md`                       |
| Inventory queries with filters                                   | RF-06                     | `porject.md`                       |
| Auth: `POST /api/v1/auth/login`, JWT validation, seed admin user | user-added BC             | `config.yaml → auth`               |
| Reference data seed (6 categories + 6 reference products)        | ops + demo                | `porject.md → Datos de Referencia` |
| Local dev via Docker Compose (postgres + pgvector)               | developer ergonomics      | `config.yaml → local_dev`          |
| Deploy to AWS dev stage via GitHub Actions OIDC                  | delivery                  | `config.yaml → infra.ci`           |

### 2.2 Out of scope (deliberate exclusions — see §9)

Multi-tenancy, RBAC beyond the single `admin` role, real-time push (websocket/SSE), mobile clients, payment integration, supplier portal, password reset flow, refresh tokens, internationalization beyond the Spanish-language UI on the frontend, prod-tag deploys in this iteration (dev stage only), CloudWatch dashboards beyond default alarms, and any code in the `domain/` layer that depends on infrastructure providers (Prisma, AWS SDK, bcrypt, JWT).

---

## 3. Affected areas

All paths follow `openspec/AGENTS.md`. No source files exist yet — these are the directories this change will populate.

### 3.1 Backend (`packages/backend/src/`)

| Bounded context | Layered folders                                            | Notes                                                                                   |
| --------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `auth/`         | `domain/`, `application/`, `infrastructure/`, `interface/` | `User` aggregate, bcrypt hasher, `jose` JWT issuer/validator, login Lambda              |
| `products/`     | same                                                       | `Product` aggregate, Prisma `ProductRepository`, read-side with rich filters            |
| `inventory/`    | same                                                       | `StockMovement` aggregate (orchestrator-locked D1), stock-adjustment use case           |
| `alerts/`       | same                                                       | `Alert` aggregate, active-alert uniqueness rule, subscription to stock-below-min        |
| `orders/`       | same                                                       | `PurchaseOrder` aggregate, transition guards (BR-5, BR-D1..BR-D3), emit `OrderReceived` |
| `shared/`       | `src/shared/`                                              | cross-BC infra utils: Prisma client factory, error mapper, JWT middleware factory       |

### 3.2 Frontend (`packages/frontend/src/`)

| Atomic level | Folder                  | Examples                                                                                           |
| ------------ | ----------------------- | -------------------------------------------------------------------------------------------------- |
| atoms        | `components/atoms/`     | Button, Input, Badge, AlertBadge                                                                   |
| molecules    | `components/molecules/` | ProductFormField, MovementFormField, StatusBadge                                                   |
| organisms    | `components/organisms/` | ProductTable, MovementHistoryTable, OrderTimeline                                                  |
| templates    | `templates/`            | DashboardLayout, AuthLayout                                                                        |
| pages        | `pages/`                | LoginPage, ProductsPage, ProductDetailPage, MovementsPage, AlertsPage, OrdersPage, OrderDetailPage |

Stores: `stores/` (Pinia) per BC; router: `router/` with lazy-loaded routes; services: `services/` wrapping `ofetch` calls per BC; i18n: `i18n/` with Spanish message keys.

### 3.3 Shared (`packages/shared/src/`)

Domain primitives (`Money`, `SKU`, `Quantity`, `MovementType`, `AlertStatus`, `OrderStatus`, `Email`, `Username`, `Role`), Zod schemas for every DTO, error envelope types, and the OpenAPI registry wiring for `@asteasolutions/zod-to-openapi`.

### 3.4 Infrastructure (`packages/infra/src/`)

| Stack / construct                               | Responsibility                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `stacks/DatabaseStack.ts`                       | RDS Postgres `db.t3.micro` with `rds.extensions = ['vector']`, secrets via SSM Parameter Store, security group |
| `stacks/ApiStack.ts`                            | API Gateway HTTP API v2, five `NodejsFunction` Lambdas, routes `/api/v1/*`, JWT secret wired from SSM          |
| `stacks/FrontendStack.ts`                       | S3 static hosting for the SPA, CloudFront distribution with OAC, redirects SPA fallback to `index.html`        |
| `stacks/AuthStack.ts` (or merged into ApiStack) | JWT secret SSM parameter with rotation hook                                                                    |
| `constructs/migrations.ts`                      | CDK CustomResource → one-shot Lambda → `prisma migrate deploy`                                                 |
| `constructs/seed.ts`                            | CDK CustomResource → one-shot Lambda → `tsx prisma/seed.ts` (orchestrator-locked D5)                           |

### 3.5 CI (`.github/workflows/`)

`ci.yml` (type-check + lint + vitest + build on every PR), `deploy-dev.yml` (push to `main` → deploy dev stage), `deploy-prod.yml` (git tag `v*` → deploy prod with manual approval, **deploy-prod is out of scope for this change** but the workflow file is scaffolded for the next iteration).

---

## 4. User stories

Eight stories cover RF-01..RF-06 + auth. Each story uses `As a [role], I want to [action], so that [outcome]` and ends with enumerated acceptance criteria.

### US-1 — Login (auth)

**As an** admin operator, **I want to** log in with username and password, **so that** I receive a JWT and can use every other endpoint.

**Acceptance criteria:**

- [ ] `POST /api/v1/auth/login` accepts `{ username, password }` and returns `{ token, expiresAt, user }` on success.
- [ ] Wrong credentials return `401` with envelope `{ code: "INVALID_CREDENTIALS", message: ... }` and do NOT leak whether the username exists.
- [ ] After 5 failed attempts within 15 minutes for the same `(IP, username)` pair, the route returns `429` (orchestrator-locked D3).
- [ ] The token is HS256 JWT, 24 h expiry, signed with `JWT_SECRET` from env (orchestrator-locked D7 / `config.yaml → auth.jwt`).
- [ ] The seed inserts exactly one admin user with bcrypt hash cost 10 (orchestrator-locked D6).

### US-2 — Register product (RF-01)

**As an** admin operator, **I want to** register products with name, SKU, category, price, stock, stock-min, supplier, **so that** the system can track them.

**Acceptance criteria:**

- [ ] `POST /api/v1/products` validates `name` (3-100 chars), `sku` (alphanumeric, 6-20 chars, **unique**), `price > 0`, `stock >= 0`, `stockMin > 0`, `categoryId` exists, `supplier` non-empty.
- [ ] On duplicate SKU the API returns `409` with `{ code: "SKU_ALREADY_EXISTS", message: ... }` (BR-D6 — never silently upsert).
- [ ] Successful create returns `201` with the persisted `Product` and its server-assigned `id`.
- [ ] The created product has `stock = 0` until a movement is applied (RF-01 starts at 0).

### US-3 — Adjust stock (RF-02)

**As an** admin operator, **I want to** record stock entries and exits with a reason, **so that** the real warehouse state is reflected and audited.

**Acceptance criteria:**

- [ ] `POST /api/v1/products/{id}/movements` accepts `{ type: "ENTRADA" | "SALIDA", quantity: int > 0, reason: string }`.
- [ ] `ENTRADA` increases `Product.stock` by `quantity`; `SALIDA` decreases it (BR-D8 — sign derives from `MovementType`).
- [ ] A `SALIDA` that would push `stock` below 0 is rejected with `422` and a message stating how much is short (BR-1).
- [ ] Each successful call writes exactly one `StockMovement` row (BR-6 append-only — no update or delete endpoints exist).
- [ ] When the new `stock <= stockMin`, a `StockBelowMinimum` event triggers the alerts BC (BR-4: at most one `ACTIVA` per product).
- [ ] The response includes the new computed `stock` so the frontend avoids a round-trip (spec decision — see §8).

### US-4 — Low-stock alerts (RF-03)

**As an** admin operator, **I want to** see a list of active low-stock alerts, **so that** I can react before products run out.

**Acceptance criteria:**

- [ ] `GET /api/v1/alerts?status=ACTIVA|RESUELTA` returns paginated alerts with the product summary.
- [ ] `GET /api/v1/alerts/{id}` returns one alert including product snapshot and resolution timestamp when `RESUELTA`.
- [ ] An alert is created automatically after any stock adjustment that leaves `stock <= stockMin` and there is no active alert (BR-4).
- [ ] When a subsequent movement raises stock strictly above `stockMin`, the active alert auto-closes and the `Alert` becomes `RESUELTA` (BR-3 + RF-03).

### US-5 — Create purchase order (RF-04)

**As an** admin operator, **I want to** create a purchase order manually or from an active alert, **so that** I can restock products against the company's policy.

**Acceptance criteria:**

- [ ] `POST /api/v1/orders` accepts `{ productId, quantity: int, fromAlertId?: uuid }` and returns `201` with the order in status `PENDIENTE`.
- [ ] `quantity >= 2 * product.stockMin` is enforced; otherwise `422` with `{ code: "ORDER_QTY_BELOW_POLICY", message: ... }` (BR-2).
- [ ] If `fromAlertId` is provided, it must reference an `ACTIVA` alert for the same `productId`; otherwise `422`.
- [ ] The order carries the product's current `supplier` snapshot at creation time (audit trail — supplier may change later).

### US-6 — Approve / reject / receive order (RF-05)

**As an** admin operator, **I want to** drive an order through its lifecycle, **so that** stock and alerts stay consistent with the real world.

**Acceptance criteria:**

- [ ] `POST /api/v1/orders/{id}/approve` requires status `PENDIENTE` (BR-5, BR-D1); otherwise `409`.
- [ ] `POST /api/v1/orders/{id}/reject` requires status `PENDIENTE` AND `reason.length >= 10` (BR-D2); otherwise `422` for short reason and `409` for wrong status.
- [ ] `POST /api/v1/orders/{id}/receive` requires status `APROBADA` (BR-D3); otherwise `409`.
- [ ] On `receive`, the system atomically (a) writes an `ENTRADA` stock movement for `quantity`, (b) updates `Product.stock`, (c) if there is an `ACTIVA` alert for the product and new stock `> stockMin`, closes it (BR-3, BR-D4).
- [ ] Failed transitions return a typed error code so the UI can render a precise message.

### US-7 — Receive closes alert (BR-3 cross-cut)

**As an** admin operator, **I want** receiving an order to close any open alert, **so that** the alerts list stays meaningful.

**Acceptance criteria:**

- [ ] Single-DB-transaction guarantee: alert closure + stock update + movement insert commit together or roll back together (design decision in §8).
- [ ] If the receive succeeds, the alert appears as `RESUELTA` on the next `GET /api/v1/alerts` call.
- [ ] If the receive fails for any reason, no partial state is visible (no half-incremented stock, no half-closed alert).

### US-8 — Query inventory (RF-06)

**As an** admin operator, **I want to** search products by category, supplier, alert state, and stock range, **so that** I can find what I need quickly.

**Acceptance criteria:**

- [ ] `GET /api/v1/products?categoryId=&supplier=&hasActiveAlert=&minStock=&maxStock=&page=&size=` returns a paginated list with applied filters.
- [ ] Filters compose with AND semantics; empty filters return the full list.
- [ ] `hasActiveAlert=true` returns only products with at least one `ACTIVA` alert (BR-4 invariant).
- [ ] The response shape and pagination metadata are stable across the four BCs that return lists (consistency rule).

---

## 5. Business rules

Six rules come verbatim from `porject.md` (BR-1..BR-6). Nine were derived while mapping the RFs in `explore.md §4.2` (BR-D1..BR-D9). All rules are binding — every one maps to at least one acceptance criterion in §4 and one Playwright scenario in §12.

| ID    | Rule                                                                                                                   | Rationale / source                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| BR-1  | A `SALIDA` movement that would drop stock below 0 is rejected; the error message states how much is short.             | `porject.md` Reglas de Negocio #1 — protects BR-6 history integrity         |
| BR-2  | `PurchaseOrder.quantity >= 2 * product.stockMin`.                                                                      | `porject.md` #2 — company policy: enough stock to clear the gap and buffer  |
| BR-3  | When a `PurchaseOrder` is `RECIBIDA` and the new stock `> stockMin`, the associated active alert closes automatically. | `porject.md` #3 + RF-03                                                     |
| BR-4  | At most one `ACTIVA` alert per `productId`.                                                                            | `porject.md` #4 — uniqueness invariant (DB partial unique index)            |
| BR-5  | Only `PENDIENTE` orders can transition to `APROBADA` or `RECHAZADA`. `RECIBIDA` is reached only from `APROBADA`.       | `porject.md` #5 — state machine                                             |
| BR-6  | `StockMovement` rows are append-only. No update or delete endpoints.                                                   | `porject.md` #6 — audit trail                                               |
| BR-D1 | Approve requires current status `PENDIENTE`.                                                                           | `explore.md §4.2` — explicit restatement of BR-5 for the approve transition |
| BR-D2 | Reject requires current status `PENDIENTE` AND rejection reason length `>= 10`.                                        | `explore.md §4.2` — RF-05 explicit                                          |
| BR-D3 | Receive requires current status `APROBADA`.                                                                            | `explore.md §4.2` — RF-05 explicit                                          |
| BR-D4 | Receive atomically increments stock AND closes the alert (single DB transaction).                                      | `explore.md §4.2` — consistency guarantee                                   |
| BR-D5 | `Product.sku` is unique across all products.                                                                           | `explore.md §4.2` — schema constraint, surfaced as 409                      |
| BR-D6 | Creating a product with an already-existing SKU does NOT update; it returns 409.                                       | `explore.md §4.2` — safer idempotency stance                                |
| BR-D7 | `StockMovement.quantity > 0`.                                                                                          | `explore.md §4.2` — a 0-qty movement is a UI bug                            |
| BR-D8 | `MovementType` drives the sign of the stock delta (`ENTRADA -> +qty`, `SALIDA -> -qty`).                               | `explore.md §4.2` — single source of truth in the entity                    |
| BR-D9 | All domain writes validate entity invariants in code BEFORE touching the DB.                                           | `explore.md §4.2` — hexagonal hygiene, defence in depth                     |

---

## 6. Architecture overview

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Browser (Vue 3 SPA)     │        │   GitHub Actions (OIDC)  │
│  Tailwind + Pinia + ofetch│       │   ci / deploy-dev        │
└──────────────┬───────────┘        └──────────────┬───────────┘
               │ HTTPS                              │ assume role
               ▼                                    ▼
┌──────────────────────────┐        ┌──────────────────────────┐
│  CloudFront → S3 (SPA)   │        │  AWS CDK pipeline        │
│  static hosting, OAC     │        │  ApiStack · DbStack ·    │
└──────────────┬───────────┘        │  FrontendStack · Seed    │
               │ /api/v1/*          └──────────────┬───────────┘
               ▼                                    │
┌──────────────────────────┐                         ▼
│  API Gateway HTTP API v2 │      ┌─────────────────────────────┐
│  routes /api/v1/*        │─────▶│ 5 Lambdas (NodejsFunction)  │
│  throttling TBD (design) │      │  auth  · products ·          │
└──────────────┬───────────┘      │  inventory · alerts · orders │
               │                  └──────────┬──────────────────┘
               │                             │ Prisma client
               ▼                             ▼
┌──────────────────────────────────────────────────────────┐
│  RDS Postgres 16 · db.t3.micro · pgvector enabled        │
│  tables: users, products, categories, stock_movements,   │
│          alerts, purchase_orders                          │
└──────────────────────────────────────────────────────────┘

Cross-cutting:
  - JWT secret → SSM Parameter Store (rotation: see §7)
  - Logs → pino → CloudWatch Logs (7-day retention)
  - Migrations & seed → CDK CustomResource → one-shot Lambda
  - BC boundary: no DB cross-joins; cross-BC reaction = design pick (see §8 Q-A1)
```

### 6.1 Per-Lambda responsibility

| Lambda             | Routes                                                                                          | Aggregate(s)                           | Cross-BC writes                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `auth-lambda`      | `POST /api/v1/auth/login`                                                                       | `User`                                 | none                                                    |
| `products-lambda`  | `POST/GET/PUT /products`, `GET /products/{id}`                                                  | `Product`                              | none                                                    |
| `inventory-lambda` | `POST /products/{id}/movements`, `GET /products/{id}/movements`                                 | `StockMovement` (+ `Product` mutation) | emits `StockAdjusted`                                   |
| `alerts-lambda`    | `GET /alerts`, `GET /alerts/{id}`                                                               | `Alert`                                | subscribes to `StockAdjusted`, closes on stock recovery |
| `orders-lambda`    | `POST /orders`, `POST /orders/{id}/{approve,reject,receive}`, `GET /orders`, `GET /orders/{id}` | `PurchaseOrder`                        | emits `OrderReceived` → consumed by inventory + alerts  |

### 6.2 Cross-BC reaction (decision deferred to design)

The interesting seams (alert open on low stock, alert close on receive, stock increment on receive) cross BC boundaries. Two mechanisms are viable; the design phase picks one:

- **Events** (preferred for future extensibility): a single in-process event bus per Lambda invocation publishes a typed event; inventory/alerts subscribe. Local in MVP, swappable for EventBridge later.
- **Direct collaborator call**: the orders use case calls a `ProductStockUpdater` port and an `AlertCloserPort` directly inside the same DB transaction.

Both keep the no-cross-DB-join rule (one Prisma transaction = one BC's responsibility). The design phase documents which path is chosen and why.

---

## 7. Cross-cutting decisions

These four decisions are binding for spec and design. They are not in `porject.md`; they are derived from operational reality + the locked stack.

### 7.1 JWT secret rotation (operational safety)

- **Initial deploy:** one secret stored in SSM Parameter Store as `JWT_SECRET`; the Lambda middleware reads and verifies only against it.
- **Rotation:** when a new secret is provisioned, store it as `JWT_SECRET` and the old one as `JWT_SECRET_PREVIOUS`. The middleware accepts tokens signed with either during an overlap window (`JWT_OVERLAP_SECONDS`, default 3600).
- **After the overlap expires:** the orchestrator removes `JWT_SECRET_PREVIOUS` and the middleware reverts to single-secret mode.
- **Why:** compromise becomes a time-bounded incident rather than an unbounded breach (`explore.md §8 R-3`).

### 7.2 Structured logging

- Library: `pino` (faster than `winston`, first-class Lambda output).
- Transport: only the built-in HTTP transport to CloudWatch Logs. No extra transport packages (cost, complexity).
- Mandatory fields: `requestId`, `userId` (from JWT), `bc`, `route`, `latencyMs`, `outcome`. Log level: `info` in dev, `info` in prod (CloudWatch Insights filters replace `debug`).

### 7.3 Decimal money

- Storage: Prisma `Decimal` (`@db.Decimal(p, s)`) on `Product.price`.
- Serialization: integer COP in every JSON response. The frontend formats with `Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })`.
- Rationale: JavaScript floats would silently round COP (`porject.md` shows no decimals, orchestrator-locked D4).
- Conversion path: `Decimal → string → parseInt` at the response mapper; never `Number(decimal)`.

### 7.4 Error envelope

- Shape: `{ code: string, message: string, details?: Record<string, unknown> }`.
- Applied to **every** 4xx and 5xx response. 2xx responses never carry an `error` field.
- Codes are stable identifiers (e.g. `INVALID_CREDENTIALS`, `SKU_ALREADY_EXISTS`, `ORDER_QTY_BELOW_POLICY`, `STOCK_WOULD_GO_NEGATIVE`); messages are localized to Spanish on the frontend only.
- A shared `errorCodes.ts` lives in `packages/shared/src/errors/` so backend and frontend agree on codes.

---

## 8. Open questions for spec / design

The orchestrator has locked 7 product decisions (D1..D7) above. These remaining questions are split: **spec-phase** picks the API surface, **design-phase** picks the architecture, and **infra-design** picks the ops knobs. Anything marked **proposal-question-round** needs a user answer before spec starts.

| ID       | Question                                                                                                                                                                              | Phase                       | Maps to explore                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------ |
| Q-A1     | Cross-BC reaction mechanism: in-process event bus OR direct collaborator port?                                                                                                        | design                      | `explore.md §3.3` note         |
| Q-A2     | Concurrent `SALIDA` strategy: `SELECT ... FOR UPDATE` on product row vs optimistic version column vs serializable isolation?                                                          | design                      | Q2 / R-2                       |
| Q-A3     | Receive transactionality: single Prisma `$transaction` covering order update + movement insert + stock update + alert close?                                                          | design                      | Q8                             |
| Q-A4     | `MovementType` storage: Postgres `ENUM` vs `VARCHAR` + CHECK constraint? (affects Prisma client shape and tests)                                                                      | design                      | Q11                            |
| Q-A5     | Region selection (default `us-east-1` for richest free tier) and CloudFront alternate domain names?                                                                                   | infra design                | `config.yaml → open_questions` |
| Q-A6     | API Gateway throttling (burst + steady) and Lambda reserved concurrency (`0` vs `1`)?                                                                                                 | infra design                | `config.yaml → open_questions` |
| Q-A7     | CloudWatch log retention default (proposed: 7 days to control cost)?                                                                                                                  | infra design                | `config.yaml → open_questions` |
| Q-S1     | Response shape for `POST /products/{id}/movements` and `POST /orders/{id}/receive`: include new computed `stock` and (when relevant) closed `alertId`?                                | spec                        | Q9                             |
| Q-S2     | Pagination contract: page+size vs cursor-based? Page+size fits MVP scale; cursor is the future-proof choice.                                                                          | spec                        | new                            |
| Q-S3     | Idempotency keys on `POST /products` and `POST /orders` for safe retries from the SPA?                                                                                                | spec                        | new (defensive)                |
| **Q-P1** | Order creation UI: wizard vs single form? Affects frontend pages, not the API.                                                                                                        | **proposal-question-round** | Q6                             |
| **Q-P2** | Should the SPA show historical stock movement trends on the product detail page, or only the latest N?                                                                                | **proposal-question-round** | new                            |
| **Q-P3** | When the order is rejected, do we keep the product's `supplier` snapshot on the order, or refresh from the live `Product.supplier`? (Snapshot is the audit-safe default.)             | **proposal-question-round** | new                            |
| **Q-P4** | Should `POST /auth/login` rate-limit also count successful logins, or only failures? (Successful-login counting rewards brute-force-resistant clients but penalizes quick operators.) | **proposal-question-round** | Q5                             |

---

## 9. Non-goals

These outcomes are explicitly NOT delivered in this change, even if they sound adjacent:

- **No multi-tenant isolation.** Single tenant, single organization. Row-level security and tenant scoping come in a future change.
- **No RBAC beyond `admin`.** Every authenticated user can do everything. Roles like `viewer`, `purchasing-agent`, `manager` are a follow-up.
- **No real-time push.** No websocket, no SSE, no GraphQL subscriptions. The SPA polls.
- **No mobile clients.** Responsive web only; no React Native, no Flutter.
- **No payments, no supplier portal.** Orders are internal records.
- **No password reset, no email verification, no refresh tokens.** Login is username + password; JWT lives 24 h.
- **No i18n beyond the Spanish UI.** Code, comments, and commits are English (`AGENTS.md`).
- **No prod-tag deploy in this iteration.** `deploy-dev.yml` ships; `deploy-prod.yml` is scaffolded but not exercised.
- **No production CloudWatch dashboards.** Default log groups + alarms only.
- **No AI features.** `EmbeddingPort` and `ChatPort` exist in the stack lock but no adapter is wired in this change; this keeps the `domain/` layer free of provider code per `config.yaml → stack.ai.rule`.

---

## 10. Risks

Severity reflects probability × blast radius for this MVP. Mitigations live in spec (S), design (D), tasks (T), or apply (A).

| ID   | Risk (from `explore.md §8`)                                               | Severity | Why                                                                                                                                                            | Mitigation (location)                                                                                                                                     |
| ---- | ------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Prisma + pgvector cold start on Lambda                                    | **High** | Each Lambda embeds Prisma + the pgvector client; first request after idle can hit 1-3 s. With five Lambdas the blast radius is wide and visible to every user. | Keep Lambdas warm via cron pings in dev only; minify Prisma client bundle; use provisioned concurrency = 0 for free tier but plan = 1 for prod (D, T)     |
| R-2  | Concurrent `SALIDA` on the same product double-spends stock               | **High** | Direct BR-1 violation; an inventory system that lies about stock is worse than no system.                                                                      | Pick `SELECT ... FOR UPDATE` on `products` row OR optimistic version column; document the chosen strategy; add a concurrent-adjustment e2e test (D, T, A) |
| R-3  | JWT secret rotation is painful, long-lived secret compromise is unbounded | Medium   | All protected endpoints depend on the JWT; a leaked secret = full system compromise.                                                                           | Dual-secret window via `JWT_SECRET` + `JWT_SECRET_PREVIOUS` (§7.1); rotation runbook in `README.md` (D, T)                                                |
| R-4  | RDS `db.t3.micro` under bursty connections OOMs                           | Medium   | Concurrent logins + adjustments + queries during business hours can exhaust 1 GB RAM.                                                                          | Connection pooling via RDS Proxy; explicit `statement_timeout`; Lambda concurrency cap = 1 per BC; alarm on `FreeableMemory` (D, T)                       |
| R-5  | API Gateway HTTP v2 cold start on first request after idle                | Medium   | Same UX hit as R-1, edge-side.                                                                                                                                 | Same as R-1 mitigation; consider HTTP API default 30 s idle timeout awareness (D)                                                                         |
| R-6  | Seed Lambda runs before migration completes on first deploy               | Medium   | Fresh environment race; idempotency failure cascade.                                                                                                           | `prisma migrate deploy` and `prisma db seed` chained in the same CustomResource Lambda; `await` the migration command before seeding (D, T)               |
| R-7  | Single `users` table, default `admin`, no RBAC                            | Low      | Anyone with creds can do anything — acceptable for MVP per scope.                                                                                              | Documented as a non-goal; production hardening is a follow-up. No mitigation in this change.                                                              |
| R-8  | `Money` rounding lost in JSON serialization                               | Low      | JavaScript floats are inaccurate for COP; small risk because all prices are integers.                                                                          | Prisma `Decimal` storage + integer serialization at the response mapper (§7.3); unit test on rounding edge cases (S, T)                                   |
| R-9  | `pgvector` extension availability on `db.t3.micro`                        | Low      | Some free-tier RDS engine versions restrict extensions; needs explicit `rds.extensions` in CDK.                                                                | Explicit `rds.extensions: ['vector']` in `DatabaseStack`; CDK assertion on stack synth; smoke test in `deploy-dev` workflow (T, A)                        |
| R-10 | Reference data drift between local Docker Postgres and CI/prod Postgres   | Low      | Versions or seed contents diverge; "works locally, fails in prod".                                                                                             | Pin `postgres:16` image tag; same seed script in local + CI + prod; CI runs seed against ephemeral DB before deploy (T, A)                                |

### 10.1 High-severity rationale

**R-1 (Prisma cold start):** the system has five Lambdas; the worst-case latency story is that the first login of the day costs 3 s. For a "control de inventario" workflow run by a single operator this is annoying but tolerable; for any concurrent user it becomes blocking. Mitigation must keep the average request latency under 500 ms p95, which means either provisioned concurrency (cost) or aggressive client-side caching + a warm-up ping on dev only. The design phase decides.

**R-2 (concurrent SALIDA):** this is the one rule whose violation destroys user trust. The system must never report a stock value that does not match the sum of all `StockMovement` rows. The mitigation is mandatory and verifiable: a Playwright scenario that fires two `SALIDA` movements concurrently and asserts that exactly one wins (or both are queued). The test is in the spec's success criteria (§12).

---

## 11. Rollback plan

Three layers of rollback, each with a different blast radius.

### 11.1 Deploy failure (CDK)

- `cdk deploy` on the dev stage is wrapped by `deploy-dev.yml`; if any stack fails to synthesize or deploy, the workflow job exits non-zero and the previous CloudFormation stack remains in service.
- Re-running the workflow after a fix is safe because the `prisma migrate deploy` and `prisma db seed` Lambdas are idempotent (`upsert` everywhere; new migrations are additive only in this change).
- If a stack must be forcibly reverted, `cdk destroy` on the failed stack is the documented escape hatch; prod never auto-destroys.

### 11.2 Business / behavior bug

- **Endpoint disable:** API Gateway HTTP API v2 supports stage-level disabling of a route via the AWS console or a one-line CLI. A buggy route can be turned off without redeploy in <1 minute.
- **Feature flag at Lambda env:** each Lambda reads toggles from env vars (`ALERT_AUTOCREATE`, `ORDERS_AUTO_RECEIVE_INVENTORY`, etc.). Toggling `ALERT_AUTOCREATE=false` neutralizes the cross-BC alert-creation path without code change; the next deploy persists the flag.
- **No live traffic re-routing** in this MVP (single stage). The next iteration can add a `canary` stage.

### 11.3 Data rollback

- RDS Postgres on the free tier does **NOT** enable point-in-time recovery (PITR). Logical rollback means a forward-fixing migration.
- Migrations in this change are additive only (new tables, new columns with defaults, new indexes). No `DROP COLUMN` or destructive `ALTER` ships.
- If a seed row is wrong, the fix is another `upsert` in `prisma/seed.ts` keyed on SKU / username; the next CI deploy re-runs the seed Lambda.

---

## 12. Success criteria

The change is "done" when every line below is verifiable on the deployed dev environment.

**Functional coverage**

- [ ] All 6 RFs (RF-01..RF-06) covered by automated Playwright e2e scenarios; one scenario per business rule BR-1..BR-6.
- [ ] BR-D1..BR-D9 each have at least one Vitest unit test in the relevant `domain/` or `application/` layer.
- [ ] Auth flow (login → token → authenticated request → 401 on missing token) is one Playwright scenario.

**Quality gates**

- [ ] Backend `domain/` + `application/` coverage ≥ 80% (locked in `config.yaml → testing.coverage_threshold`).
- [ ] Frontend coverage ≥ 60%.
- [ ] `pnpm -w vitest run`, `pnpm -w eslint`, `pnpm -w tsc --noEmit`, and `pnpm -w playwright test` all pass on CI.
- [ ] Strict TDD followed: no production code without a prior failing test (locked in `config.yaml → testing.strict_tdd`).

**Deployment and observability**

- [ ] Full pipeline deploys to the `dev` stage from `main` in ≤ 8 minutes (PR open → green check → dev URL live).
- [ ] Prod-tag deploy is scaffolded but NOT a success criterion for this change; documented in §9 non-goals.
- [ ] CloudWatch log group for each Lambda exists with 7-day retention; default `ERROR`-level alarm wired.
- [ ] Cold-start latency on first API call after 30 minutes idle < 3 s p95 for `t3.micro` Lambdas + `db.t3.micro` RDS — measured by a `wrk` / `k6` smoke script in the repo.

**Security and hygiene**

- [ ] Zero URL-embedded secrets in code, config, or commit history.
- [ ] `.env.example` committed at repo root and per package (`packages/backend`, `packages/frontend`, `packages/infra`).
- [ ] `.env` ignored in `.gitignore`.
- [ ] No `Co-Authored-By: AI` lines in commits (per repo convention).
- [ ] PR size: any PR > 400 lines uses the chained-PR pattern (`config.yaml → delivery`).

---

## Proposal question round

The seven orchestrator-locked decisions (D1..D7 above) and the 15 business rules (BR-1..BR-6 + BR-D1..BR-D9) are binding. The following product/UX questions remain open and benefit from your answer before spec starts. Each one shapes a single PR slice; defaults are noted.

1. **Q-P1 — Order creation UI:** wizard (multi-step) vs single form? Default: single form (faster to ship; aligns with the API shape).
2. **Q-P2 — Stock history:** show the full history on the product detail page, or paginate the latest 50? Default: paginated latest 50 (table grows; full history is a future filter).
3. **Q-P3 — Rejected order supplier:** snapshot at creation or refresh from `Product.supplier`? Default: snapshot (audit-safe).
4. **Q-P4 — Login rate-limit scope:** count successes too, or only failures? Default: only failures (more forgiving for operators typing their own password repeatedly).

If you want to defer all four to the design phase, write "design picks defaults" and we move on. Otherwise answer inline (1-A, 1-B, etc.) and the spec phase will encode them.

---

## Next step

Hand this proposal to the `sdd-spec` phase. The spec phase will:

1. Lock HTTP routes, request/response DTOs (Zod), status codes, and the error envelope mapping.
2. Resolve Q-S1..Q-S3 from §8.
3. Produce one spec file per BC under `openspec/changes/add-inventory-mvp/specs/`.

If you answered any Q-P1..Q-P4 above, the spec phase encodes those answers before writing DTOs.

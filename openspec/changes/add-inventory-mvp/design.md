# Design: `add-inventory-mvp` — MercadoExpress (backend portion)

**Phase:** sdd-design · **Change folder:** `openspec/changes/add-inventory-mvp/`
**Owner:** backend design (this file). Frontend (§7-§8) and final §16 are appended by another delegation.

---

## 1. TL;DR

- Five Lambda-per-BC services behind API Gateway HTTP v2 (`auth`, `products`, `inventory`, `alerts`, `orders`) hitting one RDS Postgres 16 + pgvector instance via Prisma.
- Each Lambda is a strict hexagonal `interface → application → domain ← infrastructure` layout; `domain/` has zero provider code (no Prisma, no JWT, no bcrypt).
- Cross-BC reaction for the `orders/receive` flow is **direct collaborator ports inside one Prisma `$transaction`**, NOT an event bus (Q-A1). The atomicity guarantee in OR-7 is cheaper this way and matches BR-3 / BR-4.
- `SALIDA` concurrency uses **`SELECT ... FOR UPDATE` on the `products` row** inside the mutation transaction (Q-A2). Optimistic versioning and `Serializable` are rejected as either more code or more retries.
- `MovementType` is a Postgres `ENUM` (Q-A4). `MONEY` is integer COP serialized through `Decimal → string → parseInt` (D4). bcrypt cost 10 (D6). JWT via `jose` HS256 (D7). Login rate-limit 5/15 min per `(IP, username)`, failures only (D3).
- Seed runs as a CDK CustomResource one-shot Lambda that chains `prisma migrate deploy` → `tsx prisma/seed.ts` (D5). Idempotent upserts keyed on `username` / `name` / `sku`.

---

## 2. System architecture

```
┌──────────────────────────┐
│  Browser (Vue 3 SPA)     │
│  Tailwind + Pinia + ofetch│
└──────────────┬───────────┘
               │ HTTPS
               ▼
┌──────────────────────────┐
│  CloudFront (OAC)        │
│  S3 (SPA static hosting) │
└──────────────┬───────────┘
               │ /api/v1/*
               ▼
┌────────────────────────────────────────────────────────────┐
│  API Gateway HTTP API v2                                   │
│  JWT middleware IN-LAMBDA (no Lambda authorizer)           │
│  /api/v1/auth/login            → auth-lambda              │
│  /api/v1/products, /movements  → products/inventory Lams  │
│  /api/v1/alerts                → alerts-lambda            │
│  /api/v1/orders, /approve|reject|receive → orders-lambda  │
└──────┬─────────┬───────────┬───────────┬─────────┬─────────┘
       │         │           │           │         │
       ▼         ▼           ▼           ▼         ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │  auth  │ │products│ │inventory│ │ alerts │ │ orders │   (NodejsFunction)
  │  λ     │ │   λ    │ │    λ    │ │   λ    │ │   λ    │
  └───┬────┘ └───┬────┘ └────┬────┘ └───┬────┘ └────┬───┘
      │          │           │           │           │
      └──────────┴───────────┴───────────┴───────────┘
                          │ Prisma client
                          ▼
       ┌──────────────────────────────────────────────┐
       │  RDS Postgres 16 · db.t3.micro · pgvector    │
       │  users · categories · products ·             │
       │  stock_movements · alerts · purchase_orders  │
       └──────────────────────────────────────────────┘

Cross-cutting:
  • JWT_SECRET  → SSM Parameter Store (dual-secret overlap window, see §7)
  • Logs        → pino → CloudWatch Logs (7-day retention, §12)
  • Migrations & seed → CDK CustomResource → one-shot Lambda (§10)
  • BC boundary: no DB cross-joins; one Prisma $transaction = one BC's responsibility
```

### 2.1 Per-Lambda responsibility

| Lambda             | Routes                                                                                                                      | Primary aggregate                                                | Cross-BC writes                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-lambda`      | `POST /api/v1/auth/login`                                                                                                   | `User`                                                           | none (issues JWT consumed by other Lambdas)                                                                                                                                                              |
| `products-lambda`  | `POST/GET/PATCH /api/v1/products`, `GET /api/v1/products/{id}`                                                              | `Product`                                                        | none (read-only consumed by other BCs)                                                                                                                                                                   |
| `inventory-lambda` | `POST /api/v1/products/{id}/movements`, `GET /api/v1/products/{id}/movements`                                               | `StockMovement` (+ `Product.stock` mutation via in-process port) | emits in-process `StockAdjusted` (event) and `StockBelowMinimum` / `StockRecovered`                                                                                                                      |
| `alerts-lambda`    | `GET /api/v1/alerts`, `GET /api/v1/alerts/{id}`                                                                             | `Alert`                                                          | exposes `AlertCloserPort` for `orders` (receive) and `inventory` (manual `ENTRADA` recovery) to call directly inside their respective `$transaction`s; no in-process event subscribers in MVP (RISK-001) |
| `orders-lambda`    | `POST /api/v1/orders`, `POST /api/v1/orders/{id}/{approve,reject,receive}`, `GET /api/v1/orders`, `GET /api/v1/orders/{id}` | `PurchaseOrder`                                                  | on `receive`: orchestrates `ProductStockGate` (inventory port) + `AlertCloserPort` (alerts port) + `OrderRepository.update` inside one Prisma `$transaction` (§5)                                        |

---

## 3. Hexagonal layering per Lambda — walk-through on `auth-lambda`

### 3.1 Folder tree

```
packages/backend/src/auth/
├── domain/
│   ├── user.ts                            # aggregate root
│   ├── ports/
│   │   ├── user-repository.ts             # port (interface)
│   │   ├── password-hasher.ts             # port
│   │   ├── token-issuer.ts                # port
│   │   ├── token-validator.ts             # port (used by other Lambdas via shared/)
│   │   └── rate-limiter.ts                # port
│   └── errors/
│       ├── invalid-credentials.ts
│       ├── rate-limit-exceeded.ts
│       └── user-not-found.ts
├── application/
│   ├── login.ts                           # use case
│   └── rotate-secret.ts                   # ops runbook (optional, MVP)
├── infrastructure/
│   ├── prisma-user-repository.ts          # adapter
│   ├── bcrypt-password-hasher.ts          # adapter
│   ├── jose-token-issuer.ts               # adapter
│   ├── jose-token-validator.ts            # adapter (used by all Lambdas)
│   └── postgres-rate-limiter.ts          # adapter (login_attempts table; survives cold start + multi-process — RISK-003)
├── interface/
│   ├── handlers/
│   │   └── login.ts
│   ├── schemas/
│   │   ├── login-request.ts               # Zod schema (re-exports from shared)
│   │   └── login-response.ts
│   └── middleware/
│       └── error-mapper.ts                # local use, delegates to shared
└── bootstrap.ts                           # DI wiring for the Lambda handler
```

### 3.2 Handler — `interface/handlers/login.ts`

```ts
// packages/backend/src/auth/interface/handlers/login.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { LoginUseCase } from '../../application/login';
import { loginRequestSchema } from '../schemas/login-request';
import { toErrorResponse } from '../../../shared/error-mapper';
import { withRequestContext } from '../../../shared/request-context';
import { getAuthBootstrap } from '../../bootstrap';

export const handler = withRequestContext(
  async (event: APIGatewayProxyEventV2, ctx): Promise<APIGatewayProxyResultV2> => {
    try {
      const body = loginRequestSchema.parse(JSON.parse(event.body ?? '{}'));
      const ip = event.requestContext.http.sourceIp;

      const useCase: LoginUseCase = getAuthBootstrap().loginUseCase;
      const result = await useCase.execute({
        username: body.username,
        password: body.password,
        ip,
      });

      return {
        statusCode: 200,
        headers: { 'X-Request-Id': ctx.requestId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: result.token,
          expiresAt: result.expiresAt,
          user: { id: result.user.id, username: result.user.username, role: result.user.role },
        }),
      };
    } catch (err) {
      return toErrorResponse(err, ctx);
    }
  },
);
```

### 3.3 Use case — `application/login.ts`

```ts
// packages/backend/src/auth/application/login.ts
import type { UserRepository } from '../domain/ports/user-repository';
import type { PasswordHasher } from '../domain/ports/password-hasher';
import type { TokenIssuer } from '../domain/ports/token-issuer';
import type { RateLimiter } from '../domain/ports/rate-limiter';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials';
import { RateLimitExceededError } from '../domain/errors/rate-limit-exceeded';
import { UserNotFoundError } from '../domain/errors/user-not-found';

export interface LoginInput {
  username: string;
  password: string;
  ip: string;
}

export interface LoginOutput {
  token: string;
  expiresAt: string; // ISO 8601
  user: { id: string; username: string; role: 'ADMIN' };
}

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly issuer: TokenIssuer,
    // Adapter wired at bootstrap is `PostgresRateLimiter` (login_attempts table) so
    // the failure counter survives cold starts and concurrent invocations across
    // Lambda processes. See §3.1 + `reviews/risk-review.md` RISK-003 for the rationale.
    private readonly rateLimiter: RateLimiter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const { username, ip } = input;
    const key = `${ip}::${username}`;

    // Rate-limit check is unconditional: pre-fail fast BEFORE bcrypt.
    // Per D3, only failures count. We do not increment on success.
    const failures = await this.rateLimiter.countFailures(key, /* windowSec */ 15 * 60);
    if (failures >= 5) {
      throw new RateLimitExceededError(15 * 60);
    }

    const user = await this.users.findByUsername(username);
    if (!user) {
      await this.rateLimiter.recordFailure(key, 15 * 60);
      throw new InvalidCredentialsError(); // 401, identical to wrong-password
    }

    const ok = await this.hasher.verify(input.password, user.passwordHash);
    if (!ok) {
      await this.rateLimiter.recordFailure(key, 15 * 60);
      throw new InvalidCredentialsError();
    }

    const issued = await this.issuer.issue({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }
}
```

### 3.4 Domain entity — `domain/user.ts`

```ts
// packages/backend/src/auth/domain/user.ts
import type { PasswordHash } from './value-objects/password-hash';

export type Role = 'ADMIN';

export interface UserProps {
  id: string; // UUID v4
  email: string;
  username: string; // 3-50 chars, [A-Za-z0-9._-]
  passwordHash: PasswordHash;
  role: Role;
  createdAt: Date;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static rehydrate(p: UserProps): User {
    return new User(p);
  }

  get id(): string {
    return this.props.id;
  }
  get email(): string {
    return this.props.email;
  }
  get username(): string {
    return this.props.username;
  }
  get passwordHash(): PasswordHash {
    return this.props.passwordHash;
  }
  get role(): Role {
    return this.props.role;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  // Domain invariant: username is non-empty + role is always ADMIN in MVP.
  static assertInvariants(props: UserProps): void {
    if (!props.username || props.username.length < 3) {
      throw new Error('User.username must be ≥ 3 chars');
    }
    if (props.role !== 'ADMIN') {
      throw new Error(`User.role must be ADMIN in MVP (got ${props.role})`);
    }
  }
}
```

### 3.5 Infrastructure adapter — `infrastructure/jose-token-issuer.ts`

```ts
// packages/backend/src/auth/infrastructure/jose-token-issuer.ts
import { SignJWT } from 'jose';
import type { TokenIssuer, IssuedToken } from '../domain/ports/token-issuer';

const ALG = 'HS256';
const EXP_SECONDS = 24 * 60 * 60;

export class JoseTokenIssuer implements TokenIssuer {
  constructor(
    private readonly secret: Uint8Array, // from SSM: JWT_SECRET
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(claims: { sub: string; username: string; role: 'ADMIN' }): Promise<IssuedToken> {
    const now = this.clock();
    const exp = Math.floor(now.getTime() / 1000) + EXP_SECONDS;
    const token = await new SignJWT({ username: claims.username, role: claims.role })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.sub)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.secret);

    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }
}
```

### 3.7 Tests for the auth BC

    Every test below is part of `packages/backend/src/auth/application/login.test.ts` (unit, stubbed ports) or `packages/backend/src/auth/integration/login-flow.test.ts` (integration, real Postgres via testcontainers). They map to the requirements in `specs/auth/spec.md`.

    | Scenario | Maps to | Type |
    | --- | --- | --- |
    | Valid creds → 200 + JWT; wrong password → 401 with `INVALID_CREDENTIALS`; missing user → byte-identical 401 (no enumeration) | AU-1, AU-2 | unit + integration |
    | Fifth failure within 15 min → 429 with `RATE_LIMITED` and `retryAfterSeconds` | AU-4, Q-P4 | unit (stubbed `RateLimiter`) |
    | Successful login does NOT increment the failure counter | AU-4, Q-P4 | unit |
    | Different `(IP, username)` pairs do not share the counter | AU-4 | unit |
    | Window expiry: failures older than 15 min are not counted | AU-4 | unit |
    | **Postgres rate limiter survives cold start (count persists across `prisma.$disconnect()` / reconnect)** — fires 5 failures, calls `await prisma.$disconnect()`, re-connects, fires attempt 6, asserts 429. Proves the failure counter is **not** in-process (RISK-003). | AU-4, D3, RISK-003 | integration |
    | Dual-secret rotation: token signed by `JWT_SECRET_PREVIOUS` is accepted within `JWT_OVERLAP_SECONDS`, rejected after | AU-rot | integration |
    | Wrong-algorithm JWT → 401 with `UNAUTHORIZED` | AU-rot | unit |

    ### 3.6 Dependency direction reminder

```
interface/  →  application/  →  domain/  ←  infrastructure/
   (HTTP)        (use cases)     (pure)        (Prisma, jose, bcrypt)
```

The `domain/` layer imports from no other layer. `application/` imports from `domain/`. `interface/` and `infrastructure/` import from `application/` and `domain/`. This is enforced by `eslint-plugin-boundaries` (added in tasks) and is what keeps the `domain/` testable in microseconds with no fixtures.

---

## 4. Prisma schema (DDL intent)

Postgres 16 + pgvector. UUIDs are `gen_random_uuid()` (pgcrypto). Money is `Decimal(12, 0)` and serialized as integer COP (D4). All FKs use `ON DELETE RESTRICT` by default unless stated.

```sql
-- 4.1 users (auth)
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,                 -- bcrypt $2b$10$...; never returned
  role          TEXT        NOT NULL DEFAULT 'admin', -- MVP: only 'admin' (D2 analogue for users)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_username_idx ON users (username); -- supports login lookup
```

```sql
-- 4.2 categories (lookup, D2)
CREATE TABLE categories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,             -- 2-40 chars; validated in app
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```sql
-- 4.3 products
CREATE TABLE products (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT           NOT NULL UNIQUE,         -- [A-Za-z0-9]{6,20}
  name        TEXT           NOT NULL,                -- 3-100 chars
  category_id UUID           NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  price       DECIMAL(12, 0) NOT NULL,                -- integer COP, no decimals
  stock       INT            NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_min   INT            NOT NULL CHECK (stock_min > 0),
  supplier    TEXT           NOT NULL,                -- 1-120 chars
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX products_sku_idx         ON products (sku);          -- unique (implicit)
CREATE INDEX products_category_idx    ON products (category_id);
CREATE INDEX products_supplier_idx    ON products (supplier);
CREATE INDEX products_stock_range_idx ON products (stock);        -- supports min/max filters
```

```sql
-- 4.4 stock_movements (D1 — own aggregate, no inbound FKs)
-- Other BCs reference movements by id ONLY through the in-process event payload,
-- never as a foreign key column. This is the D1 invariant.
CREATE TYPE  movement_type AS ENUM ('ENTRADA', 'SALIDA');         -- Q-A4 (Postgres ENUM)

CREATE TABLE stock_movements (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type        movement_type  NOT NULL,                            -- Q-A4
  quantity    INT            NOT NULL CHECK (quantity > 0),       -- BR-D7
  reason      TEXT           NOT NULL,                            -- 3-200 chars
  user_id     UUID           NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_created_idx ON stock_movements (product_id, created_at DESC);
```

> **D1 invariant note (IN-1):** `products`, `alerts`, and `purchase_orders` MUST NOT contain any FK column referencing `stock_movements.id`. The Prisma model omits the relation. This is reviewed in PR.

```sql
-- 4.5 alerts (BR-4 uniqueness)
CREATE TYPE alert_status AS ENUM ('ACTIVA', 'RESUELTA');

CREATE TABLE alerts (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  status      alert_status  NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ   NULL
);
-- BR-4 partial unique: at most one ACTIVA per productId.
CREATE UNIQUE INDEX alerts_one_active_per_product
  ON alerts (product_id)
  WHERE status = 'ACTIVA';
CREATE INDEX alerts_status_idx ON alerts (status);
```

````sql
    -- 4.6 login_attempts (RISK-003 — rate limiter storage)
    CREATE TABLE login_attempts (
      id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      ip           INET         NOT NULL,
      username     TEXT         NOT NULL,
      success      BOOLEAN      NOT NULL,
      attempted_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    -- Partial index that the rate limiter queries: count recent failures for (ip, username).
    CREATE INDEX login_attempts_ip_username_failure_idx
      ON login_attempts (ip, username, attempted_at DESC)
      WHERE success = false;
    ```

    ```sql
    -- 4.7 purchase_orders
CREATE TYPE order_status AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'RECIBIDA');

CREATE TABLE purchase_orders (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID          NOT NULL REFERENCES products(id)     ON DELETE RESTRICT,
  quantity           INT           NOT NULL CHECK (quantity > 0),
  supplier_snapshot  TEXT          NOT NULL,                              -- Q-P3: write-once
  from_alert_id      UUID          NULL     REFERENCES alerts(id)     ON DELETE SET NULL,
  status             order_status  NOT NULL DEFAULT 'PENDIENTE',
  rejection_reason   TEXT          NULL,                                  -- ≥ 10 chars when set (BR-D2)
  created_by         UUID          NOT NULL REFERENCES users(id)       ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX orders_product_idx  ON purchase_orders (product_id);
CREATE INDEX orders_status_idx   ON purchase_orders (status);
CREATE INDEX orders_created_idx  ON purchase_orders (created_at DESC);
````

### 4.7 Indexes recap

| Table             | Index                                                                     | Purpose                                                                                                |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `users`           | PK + `username` UNIQUE + `email` UNIQUE                                   | login lookup, conflict detection                                                                       |
| `categories`      | PK + `name` UNIQUE                                                        | lookup uniqueness                                                                                      |
| `products`        | PK + `sku` UNIQUE + `category_id`, `supplier`, `stock`                    | filter combinations for RF-06                                                                          |
| `stock_movements` | PK + `(product_id, created_at DESC)`                                      | history page (Q-P2)                                                                                    |
| `alerts`          | PK + partial unique on `(product_id) WHERE status='ACTIVA'` + `status`    | BR-4 + list filter                                                                                     |
| `purchase_orders` | PK + `product_id`, `status`, `created_at DESC`                            | list filters + sort                                                                                    |
| `login_attempts`  | PK + partial on `(ip, username, attempted_at DESC) WHERE success = false` | RISK-003: 5-failure/15-min rate-limit counter that survives cold start and concurrent Lambda processes |

---

## 5. Cross-BC reaction (Q-A1 + Q-A3)

### 5.1 The decision

For the **orders-receive** flow we choose **direct collaborator ports inside one Prisma `$transaction`**, NOT an in-process event bus. For the **inventory → alerts** low-stock path we keep an in-process event bus because it is fire-and-forget and the alerts side-effect is tolerant of an in-process event.

This is asymmetric by design: atomicity wins where the spec mandates it (OR-7 + BR-3 + BR-4), event-bus simplicity wins where it does not (the create-side `StockBelowMinimum` notification).

### 5.2 Receive flow orchestration (Q-A1 + Q-A3)

```
POST /api/v1/orders/{id}/receive
        │
        ▼
  receive-order.ts (handler)             ← orders-lambda/interface/handlers
        │
        ▼
  ReceiveOrderUseCase.execute()          ← orders-lambda/application
        │
        ▼
  prisma.$transaction(async (tx) => {    ← ONE Prisma transaction (Q-A3)
    1.  orders/order-repository.txUpdate(id, status='RECIBIDA')           [UPDATE purchase_orders]
    2.  inventory/ports/product-stock-gate.txIncrementStock(productId, +qty) [INSERT stock_movement + UPDATE products.stock]
    3.  inventory/stock-mutation-service emits in-process StockAdjusted    [in-process event]
    4.  alerts/ports/alert-closer-port.txCloseIfOpenAndAboveMin(productId, newStock) [UPDATE alerts SET status='RESUELTA']
  }, { isolationLevel: 'ReadCommitted' })
        │
        ▼
  Return { order, stockAfter, closedAlertId? }
```

### 5.3 Ports & adapters

```ts
// packages/backend/src/inventory/domain/ports/product-stock-gate.ts
import type { PrismaClient } from '@prisma/client';

export interface StockMovementRecorded {
  productId: string;
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  stockAfter: number;
  stockMin: number;
  occurredAt: Date;
}

export interface ProductStockGate {
  /**
   * Atomically inserts the StockMovement row and updates products.stock.
   * MUST be called inside an existing prisma $transaction; it does NOT
   * start its own. Performs the SELECT ... FOR UPDATE row lock.
   */
  txIncrementStock(
    tx: PrismaClient,
    args: {
      productId: string;
      type: 'ENTRADA' | 'SALIDA';
      quantity: number;
      reason: string;
      userId: string;
    },
  ): Promise<StockMovementRecorded>;
}
```

```ts
// packages/backend/src/alerts/domain/ports/alert-closer-port.ts
import type { PrismaClient } from '@prisma/client';

export interface AlertCloserPort {
  /**
   * Closes the active alert for productId IF it exists AND newStock > stockMin.
   * MUST be called inside an existing prisma $transaction (used by orders/receive).
   * Returns the closed alert id, or null if no alert was open / the close condition
   * was not met.
   */
  txCloseIfOpenAndAboveMin(
    tx: PrismaClient,
    args: { productId: string; newStock: number; stockMin: number },
  ): Promise<{ alertId: string } | null>;
}
```

Their **Prisma-backed** adapters live in:

- `packages/backend/src/inventory/infrastructure/prisma-product-stock-gate.ts` — uses `$queryRaw` to lock the product row, then writes the movement and updates stock in the same tx.
- `packages/backend/src/alerts/infrastructure/prisma-alert-closer-port.ts` — runs the partial-unique-safe `UPDATE alerts SET status='RESUELTA', resolved_at=now() WHERE product_id = $1 AND status = 'ACTIVA' RETURNING id` inside the supplied tx.

### 5.4 Why direct ports + `$transaction` over an event bus for `receive`

1. **OR-7 atomicity is mandatory and verifiable.** The receive flow MUST commit the order status flip, the `ENTRADA` movement, the product stock update, and the alert close as one unit. An event bus would split this into "commit order" + "emit event" + "consume event" + "commit alert close" — each step a new failure mode and a new retry story. A single Prisma `$transaction` is the cheapest atomic primitive Prisma exposes for this stack.
2. **BR-3 and BR-4 are DB invariants.** The "at most one ACTIVA per product" rule is enforced by a partial unique index. Closing the alert must observe and mutate the same DB state the order update just wrote. A cross-Lambda event bus would force us to either (a) re-read product + alert before the close, opening a TOCTOU window, or (b) rely on EventBridge ordering keys. Both are heavier than `$transaction`.
3. **Cost and surface area stay small.** The MVP ships one Lambda per BC; the only seam between BCs is the receive flow. Adding an event bus for one seam is YAGNI. We keep an in-process bus for the _create-side_ low-stock notification (no atomicity required there) and document the EventBridge swap-in as v2.
4. **No cross-DB joins, still.** The ports use the same Prisma client passed into the tx; the rule "one Prisma `$transaction` = one BC's responsibility" is preserved because all writes still originate from `orders-lambda`.

### 5.5 No event bus for the manual-ENTRADA recovery path

We do **not** use an event bus for the manual-ENTRADA recovery path (nor for any other cross-Lambda seam in MVP). `InProcessEventBus` would be a per-process class field; two separate Lambda invocations are two processes and never share state — so a `bus.emit` from `inventory-lambda` is invisible to `alerts-lambda`. The design rejects that transport entirely.

Instead, `inventory-lambda` calls `AlertCloserPort` **directly inside the same `prisma.$transaction`** — mirroring the receive flow in §5.2. The closer port is idempotent (no active alert → no-op), and the BR-3 / BR-4 invariants are enforced by the same partial unique index and the same `prisma.$transaction` primitive that already protects the receive flow. Event-driven decoupling (EventBridge swap-in) is documented as a v2 follow-up; the in-process bus file is **removed** from §14.1 to keep the manifest honest about what ships.

### 5.6 v2 swap-in (no code shipped)

When a second consumer emerges (analytics, supplier auto-email), the **direct-port + `$transaction`** pattern from §5.2 / §6.3 step 6 stays in place for atomicity-sensitive seams; an `EventBridgeEventBus` adapter is added for seams that do not require OR-7 atomicity. No `EventBus` port is defined in MVP because no code emits or consumes one. This is documented as a follow-up, not built now.

---

## 6. Concurrency (Q-A2)

### 6.1 The decision

We use **pessimistic row lock via `SELECT ... FOR UPDATE`** on `products.id` inside the mutation transaction, at Postgres default isolation (`ReadCommitted`). We reject optimistic versioning (extra column, extra read round-trip, retry storm under burst) and `Serializable` (overkill, more retries for the same correctness we get from the row lock).

### 6.2 Why default `ReadCommitted` is enough

`Serializable` would prevent every concurrent write to `products`, including non-stock writes (e.g. supplier rename). That costs throughput we do not need. `ReadCommitted` + an explicit `SELECT ... FOR UPDATE` on the exact row being mutated serializes only the **stock** writes for that product, which is exactly BR-1's requirement. The other BC's product updates (PATCH on `supplier`, `price`, `name`) are not blocked.

### 6.3 `StockMutationService` flow

```
prisma.$transaction(async (tx) => {
  // 1. Lock the product row
  const [row] = await tx.$queryRaw<Array<{ id: string; stock: number; stock_min: number }>>`
    SELECT id, stock, stock_min FROM products WHERE id = ${productId}::uuid FOR UPDATE
  `;
  if (!row) throw new ProductNotFoundError(productId);

  // 2. Apply business rule BR-1 (sign from MovementType, BR-D8)
  const delta = type === 'ENTRADA' ? +quantity : -quantity;
  const newStock = Number(row.stock) + delta;
  if (newStock < 0) throw new StockWouldGoNegativeError({ currentStock: row.stock, requested: quantity, shortBy: -newStock });

  // 3. Insert StockMovement (append-only, BR-6)
  const movement = await tx.stockMovement.create({
    data: { id: randomUUID(), productId, type, quantity, reason, userId, createdAt: new Date() },
  });

// 4. Update product stock
  await tx.product.update({ where: { id: productId }, data: { stock: newStock } });

  // 5. If crossing below min AND no existing active alert (BR-4), create one.
  //    The precondition check + the partial unique index are belt-and-suspenders:
  //    even under a concurrent mutation, only one row inserts.
  if (newStock <= row.stock_min) {
    const existingActiva = await tx.alert.findFirst({
      where: { productId, status: 'ACTIVA' },
    });
    if (!existingActiva) {
      await tx.alert.create({
    data: { id: randomUUID(), productId, status: 'ACTIVA', createdAt: new Date() },
      });
    }
  }

  // 6. If newStock strictly exceeds stockMin, close any active alert (BR-3 recovery).
  //    Direct call to AlertCloserPort inside the same tx — mirrors the receive flow
  //    in §5.2 step 4. The closer is idempotent: no active alert = no-op.
  if (newStock > row.stock_min) {
    await this.alertCloserPort.txCloseIfOpenAndAboveMin(tx, {
      productId,
      newStock,
      stockMin: row.stock_min,
    });
  }

  return { movementId: movement.id, stockAfter: newStock };
}, { isolationLevel: 'ReadCommitted' });
```

### 6.4 Code shape — `stock-mutation-service.ts`

```ts
// packages/backend/src/inventory/application/stock-mutation-service.ts
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { StockWouldGoNegativeError } from '../domain/errors/stock-would-go-negative';
import { ProductNotFoundError } from '../domain/errors/product-not-found';
import type { AlertCloserPort } from '../../alerts/domain/ports/alert-closer-port';

export interface RecordMovementInput {
  productId: string;
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  reason: string;
  userId: string;
}

export class StockMutationService {
  constructor(
    private readonly prisma: PrismaClient,
    // AlertCloserPort is owned by the `alerts` BC; we depend on the port, not the
    // implementation. See §5.5 for why this is a direct port call instead of an
    // in-process event bus, and §6.3 step 6 for the BR-3 recovery flow.
    private readonly alertCloserPort: AlertCloserPort,
  ) {}

  async record(input: RecordMovementInput) {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; stock: number; stock_min: number }>>`
        SELECT id, stock, stock_min FROM products WHERE id = ${input.productId}::uuid FOR UPDATE
      `;
        const row = rows[0];
        if (!row) throw new ProductNotFoundError(input.productId);

        const delta = input.type === 'ENTRADA' ? input.quantity : -input.quantity;
        const newStock = Number(row.stock) + delta;
        if (newStock < 0) {
          throw new StockWouldGoNegativeError({
            currentStock: Number(row.stock),
            requested: input.quantity,
            shortBy: -newStock,
          });
        }

        const movement = await tx.stockMovement.create({
          data: {
            id: randomUUID(),
            productId: input.productId,
            type: input.type,
            quantity: input.quantity,
            reason: input.reason,
            userId: input.userId,
            createdAt: new Date(),
          },
        });

        await tx.product.update({ where: { id: input.productId }, data: { stock: newStock } });

        // (No in-process event emit; the recovery path is handled by AlertCloserPort below.)

        if (newStock <= row.stock_min) {
          try {
            await tx.alert.create({
              data: {
                id: randomUUID(),
                productId: input.productId,
                status: 'ACTIVA',
                createdAt: new Date(),
              },
            });
          } catch (e: any) {
            if (e?.code !== 'P2002') throw e; // unique_violation from BR-4 partial index → swallow
          }
        }

        // 6. If newStock strictly exceeds stockMin, close any active alert (BR-3 recovery).
        //    Direct call to AlertCloserPort inside the same tx — mirrors the receive flow
        //    in §5.2 step 4. The closer is idempotent: no active alert = no-op.
        if (newStock > row.stock_min) {
          await this.alertCloserPort.txCloseIfOpenAndAboveMin(tx, {
            productId: input.productId,
            newStock,
            stockMin: row.stock_min,
          });
        }

        return { movementId: movement.id, stockAfter: newStock };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
```

> The same locking discipline is invoked when `orders-lambda` calls `ProductStockGate.txIncrementStock` inside the receive tx (§5). The row lock serializes concurrent receives + manual `SALIDA` against the same product.

---

<!-- BEGIN-FRONTEND-DESIGN -->

## 7. Frontend architecture

### 7.1 Stack lock (binding)

- **Tooling:** Vite + Vue 3 + TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`).
- **Authoring style:** Composition API + `<script setup lang="ts">` everywhere; no Options API, no `defineComponent` boilerplate.
- **Styling:** TailwindCSS as the utility layer; no CSS-in-JS, no BEM, no per-component scoped CSS except where Tailwind cannot express the rule (rare; ≤ 1 file per page for grid quirks).
- **State:** Pinia (composition-style stores via `defineStore('name', () => { ... })`).
- **Routing:** `vue-router` v4, lazy-loaded routes (`() => import('./pages/...')`).
- **HTTP:** `ofetch` wrappers, one per BC, in `src/services/<bc>/`.
- **i18n:** `vue-i18n` v9; Spanish (`es-CO`) is the active locale; English is the fallback. All UI strings live in `packages/frontend/src/i18n/<locale>.json`. UI labels in Spanish; code, comments, commit messages, PR titles in English (`AGENTS.md`).
- **No SSR.** SPA only — no Nuxt, no `vue-meta` SSR plugin, no server hydration. Vite dev server in local; S3 + CloudFront in prod.
- **No third-party UI kit.** The brief calls for an opinionated, distinctive visual identity (frontend-design skill, §8). A library like PrimeVue or Vuetify would erase that.

### 7.2 Folder layout

Per `openspec/AGENTS.md` and `config.yaml → conventions.frontend`:

````
packages/frontend/
├── src/
│   ├── components/
│   │   ├── atoms/                 # Button, Input, Badge, Select, Checkbox, Skeleton, IconButton
│   │   ├── molecules/             # FormField (label + input + error), StatusBadge, PageHeader, FilterStrip
│   │   └── organisms/             # ProductTable, MovementHistoryTable, OrderTimeline, AlertCard
│   ├── templates/                 # DashboardLayout, AuthLayout (slots; no business data)
│   ├── pages/
│   │   ├── auth/LoginPage.vue
│   │   ├── products/
│   │   │   ├── ProductsListPage.vue
│   │   │   ├── ProductCreatePage.vue
│   │   │   └── ProductDetailPage.vue          # embeds MovementHistoryTable at latest-50 (Q-P2)
│   │   ├── inventory/
│   │   │   ├── MovementsListPage.vue
│   │   │   └── RecordMovementPage.vue
│   │   ├── alerts/
│   │   │   ├── AlertsListPage.vue
│   │   │   └── AlertDetailPage.vue
│   │   ├── orders/
│   │   │   ├── OrdersListPage.vue
│   │   │   ├── OrderCreatePage.vue            # SINGLE FORM (Q-P1)
│   │   │   └── OrderDetailPage.vue            # approve / reject / receive action bar gated by status
│   │   └── categories/
│   │       └── CategoriesListPage.vue
│   ├── stores/
│   │   ├── auth.ts                # useAuthStore: token, user, login(), logout()
│   │   ├── products.ts            # useProductsStore
│   │   ├── inventory.ts           # useInventoryStore
│   │   ├── alerts.ts              # useAlertsStore
│   │   ├── orders.ts              # useOrdersStore
│   │   └── categories.ts          # useCategoriesStore
│   ├── router/
│   │   ├── index.ts               # createRouter, scrollBehavior, guards
│   │   └── routes.ts              # typed route record (lazy imports)
│   ├── services/
    │   │   ├── http.ts                # ofetch instance factory (base URL + auth interceptor)
    │   │   ├── auth.ts                # loginService
    │   │   ├── products.ts            # listProducts({ filters }), getProduct(id), createProduct(...)
    │   │   ├── inventory.ts           # recordMovement(...), listMovements(productId, { page, size })
    │   │   ├── alerts.ts              # listAlerts({ status, page, size }), getAlert(id)
    │   │   ├── orders.ts              # listOrders, getOrder, createOrder, approveOrder, rejectOrder, receiveOrder
    │   │   └── categories.ts          # listCategories, createCategory
    │   ├── i18n/
    │   │   ├── index.ts               # createI18n({ locale: 'es-CO', fallbackLocale: 'en' })
    │   │   ├── es-CO.json             # Spanish UI strings (the only locale shipped)
    │   │   └── en.json                # English fallback for development
    │   ├── styles/
    │   │   ├── tokens.css             # CSS custom properties — the palette, type, spacing, motion (§8)
    │   │   └── tailwind.css           # @tailwind base/components/utilities + token bindings
    │   ├── env.d.ts                   # ImportMetaEnv types (VITE_API_BASE_URL)
    │   └── main.ts                    # createApp, install pinia, router, i18n
    ├── public/
    ├── index.html                     # mounted via CloudFront (§15)
    ├── tailwind.config.ts             # uses CSS variables as theme tokens
    ├── tsconfig.json                  # strict, project refs to shared
    └── package.json
    ```

    ### 7.3 Pages — concrete inventory

    | Route | Page file | BC | Notes |
    | --- | --- | --- | --- |
    | `/login` | `pages/auth/LoginPage.vue` | auth | Public; uses `AuthLayout` template. Redirects to `/productos` on success. |
    | `/productos` | `pages/products/ProductsListPage.vue` | products | Filter strip + table (the hero wireframe in §8.6). Pagination footer. |
    | `/productos/nuevo` | `pages/products/ProductCreatePage.vue` | products | Form, category select from `useCategoriesStore`, SKU uniqueness surfaced as inline error. |
    | `/productos/:id` | `pages/products/ProductDetailPage.vue` | products | Header card + edit fields + **`MovementHistoryTable`** at default `size = 50` (Q-P2). |
    | `/movimientos` | `pages/inventory/MovementsListPage.vue` | inventory | All-movements view across products; filter by product + type. |
    | `/movimientos/nuevo` | `pages/inventory/RecordMovementPage.vue` | inventory | Form: product picker, ENTRADA/SALIDA radio, qty, reason. |
    | `/alertas` | `pages/alerts/AlertsListPage.vue` | alerts | Default `status = ACTIVA`. Each row links to detail; CTA "Crear orden" passes `fromAlertId` query param. |
    | `/alertas/:id` | `pages/alerts/AlertDetailPage.vue` | alerts | Read-only card with product snapshot + resolution timestamp. |
    | `/ordenes` | `pages/orders/OrdersListPage.vue` | orders | Default newest-first. |
    | `/ordenes/nueva` | `pages/orders/OrderCreatePage.vue` | orders | **Single form** (Q-P1): productId + quantity + optional `fromAlertId` (read from `?fromAlertId=` query). |
    | `/ordenes/:id` | `pages/orders/OrderDetailPage.vue` | orders | Card + action bar: **Aprobar** / **Rechazar** / **Recibir** — each rendered only when the current `status` allows the transition (BR-5 + BR-D1..BR-D3). |
    | `/categorias` | `pages/categories/CategoriesListPage.vue` | categories | Lookup list (RF-01 support). |

    ### 7.4 Router — lazy-loaded routes with code-splitting

    ```ts
    // packages/frontend/src/router/routes.ts
    import type { RouteRecordRaw } from 'vue-router';

    export const routes: RouteRecordRaw[] = [
      {
        path: '/login',
        name: 'login',
        component: () => import('../pages/auth/LoginPage.vue'),
        meta: { layout: 'auth', requiresAuth: false },
      },
      {
        path: '/',
        redirect: { name: 'products-list' },
      },
      {
        path: '/productos',
        name: 'products-list',
        component: () => import('../pages/products/ProductsListPage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/productos/nuevo',
        name: 'product-create',
        component: () => import('../pages/products/ProductCreatePage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/productos/:id',
        name: 'product-detail',
        component: () => import('../pages/products/ProductDetailPage.vue'),
        props: true,
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/movimientos',
        name: 'movements-list',
        component: () => import('../pages/inventory/MovementsListPage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/movimientos/nuevo',
        name: 'movement-create',
        component: () => import('../pages/inventory/RecordMovementPage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/alertas',
        name: 'alerts-list',
        component: () => import('../pages/alerts/AlertsListPage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/alertas/:id',
        name: 'alert-detail',
        component: () => import('../pages/alerts/AlertDetailPage.vue'),
        props: true,
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/ordenes',
        name: 'orders-list',
        component: () => import('../pages/orders/OrdersListPage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/ordenes/nueva',
        name: 'order-create',
        component: () => import('../pages/orders/OrderCreatePage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/ordenes/:id',
        name: 'order-detail',
        component: () => import('../pages/orders/OrderDetailPage.vue'),
        props: true,
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/categorias',
        name: 'categories-list',
        component: () => import('../pages/categories/CategoriesListPage.vue'),
        meta: { layout: 'dashboard', requiresAuth: true },
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../pages/NotFoundPage.vue'),
        meta: { layout: 'auth', requiresAuth: false },
      },
    ];
    ```

    The `router/index.ts` module installs a `beforeEach` guard that redirects to `/login` when `requiresAuth === true` and `useAuthStore().token` is null (and persists the intended path for post-login redirect). Per-locale `<title>` is updated by a `afterEach` hook that reads `route.meta.titleKey` and calls `i18n.t(...)`.

    Code-splitting is automatic: every `() => import(...)` becomes a separate Vite chunk. Login, products list, and order detail are independent bundles; the user only downloads what they visit.

    ### 7.5 Pinia stores — naming and shape

    Naming convention: **`use<BC>Store`** — one store per bounded context. Composition-style setup, no options API:

    ```ts
    // packages/frontend/src/stores/products.ts
    import { defineStore } from 'pinia';
    import { ref, computed } from 'vue';
    import * as svc from '@/services/products';

    export const useProductsStore = defineStore('products', () => {
      const items = ref<svc.Product[]>([]);
      const page = ref(1);
      const size = ref(20);
      const total = ref(0);
      const filters = ref<svc.ProductFilters>({
        categoryId: undefined,
        supplier: undefined,
        hasActiveAlert: undefined,
        minStock: undefined,
        maxStock: undefined,
      });
      const loading = ref(false);
      const error = ref<svc.ApiError | null>(null);

      const hasMore = computed(() => page.value * size.value < total.value);

      async function fetchList() { /* … calls svc.listProducts, hydrates items/page/total … */ }
      async function fetchOne(id: string) { /* … */ }
      async function create(input: svc.CreateProductInput) { /* … */ }

      return { items, page, size, total, filters, loading, error, hasMore, fetchList, fetchOne, create };
    });
    ```

    Per-BC stores:

    | Store | State | Actions |
    | --- | --- | --- |
    | `useAuthStore` | `token`, `user`, `expiresAt` | `login`, `logout`, `restore` (read token from `localStorage` on app boot) |
    | `useProductsStore` | `items`, `page`, `size`, `total`, `filters`, `loading`, `error` | `fetchList`, `fetchOne`, `create`, `update` |
    | `useInventoryStore` | `movementsByProduct` (Map), `page`, `size`, `total` | `fetchMovements(productId)`, `recordMovement(input)` |
    | `useAlertsStore` | `items`, `page`, `total`, `statusFilter` | `fetchList({ status })`, `fetchOne(id)` |
    | `useOrdersStore` | `items`, `page`, `total`, `statusFilter`, `current` | `fetchList`, `fetchOne`, `create`, `approve`, `reject`, `receive` |
    | `useCategoriesStore` | `items` | `fetchList`, `create` |

    Token persistence: the store reads/writes `localStorage` under `mercadoexpress.auth` (JSON-encoded `{ token, user, expiresAt }`). On boot, `restore()` validates `expiresAt > now()` and clears if expired. There is no refresh token (proposal §9 non-goal).

    ### 7.6 ofetch — base URL + auth header

    ```ts
    // packages/frontend/src/services/http.ts
    import { ofetch, type $Fetch } from 'ofetch';
    import { useAuthStore } from '@/stores/auth';

    const baseURL = import.meta.env.VITE_API_BASE_URL as string;

    export const http: $Fetch = ofetch.create({
      baseURL,
      retry: 0,                                  // backend returns typed error envelopes; SPA does not silently retry
      timeout: 10_000,
      onRequest({ options }) {
        const auth = useAuthStore();
        if (auth.token) {
          options.headers.set('Authorization', `Bearer ${auth.token}`);
        }
        const rid = crypto.randomUUID();
        options.headers.set('X-Request-Id', rid);
      },
      onResponseError({ response }) {
        // Map backend ErrorEnvelope into a typed ApiError the UI can branch on.
        if (response.status === 401) {
          useAuthStore().logout();               // token expired / revoked — bounce to /login
        }
      },
    });
    ```

    `VITE_API_BASE_URL` is wired per environment:

    - `packages/frontend/.env.development` → `http://localhost:3001/local` (or the SAM local stage).
    - `packages/frontend/.env.production` → `https://<api-id>.execute-api.<region>.amazonaws.com` (injected by CDK synth).

    Each BC service module composes typed methods on top of `http`:

    ```ts
    // packages/frontend/src/services/products.ts
    import { http } from '@/http';
    import type { components } from '@mercadoexpress/shared/openapi'; // generated from zod-to-openapi

    export type Product = components['schemas']['Product'];
    export type ProductFilters = components['schemas']['ProductFilters'];
    export type CreateProductInput = components['schemas']['CreateProductInput'];

    export async function listProducts(params: ProductFilters & { page: number; size: number }) {
      const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null) as [string, string][]);
      return http<{ items: Product[]; page: number; size: number; total: number; hasMore: boolean }>(`/api/v1/products?${query}`);
    }

    export async function getProduct(id: string) { return http<Product>(`/api/v1/products/${id}`); }
    export async function createProduct(input: CreateProductInput) {
      return http<Product>('/api/v1/products', { method: 'POST', body: input });
    }
    ```

    DTO types are derived from the OpenAPI registry generated by `zod-to-openapi` in `packages/shared`; the SPA never redefines shapes (no duplicated types, per `AGENTS.md`).

    ### 7.7 i18n (Spanish UI)

    `packages/frontend/src/i18n/es-CO.json` is the only locale shipped. Keys are namespaced by page + element:

    ```json
    {
      "auth": {
        "login": {
          "title": "Iniciar sesión",
          "usernameLabel": "Usuario",
          "passwordLabel": "Contraseña",
          "submit": "Entrar",
          "invalidCredentials": "Usuario o contraseña incorrectos.",
          "rateLimited": "Demasiados intentos. Intenta de nuevo en unos minutos."
        }
      },
      "products": {
        "list": {
          "title": "Productos",
          "empty": "No hay productos todavía. Crea el primero.",
          "searchPlaceholder": "Buscar por nombre o SKU…"
        },
        "fields": {
          "sku": "SKU",
          "name": "Nombre",
          "category": "Categoría",
          "price": "Precio",
          "stock": "Stock",
          "stockMin": "Stock mínimo",
          "supplier": "Proveedor",
          "status": "Estado"
        },
        "status": {
          "ok": "En stock",
          "warning": "Stock bajo",
          "danger": "Sin stock"
        }
      },
      "orders": {
        "create": {
          "title": "Nueva orden de compra",
          "quantityLabel": "Cantidad",
          "quantityHelp": "Debe ser al menos 2 veces el stock mínimo del producto.",
          "fromAlertLabel": "Origen",
          "submit": "Crear orden",
          "belowPolicy": "La cantidad solicitada debe ser al menos 2 veces el stock mínimo."
        },
        "actions": {
          "approve": "Aprobar",
          "reject": "Rechazar",
          "receive": "Marcar recibida",
          "rejectReasonLabel": "Motivo del rechazo (mínimo 10 caracteres)"
        }
      },
      "common": {
        "save": "Guardar",
        "cancel": "Cancelar",
        "retry": "Reintentar",
        "contactSupport": "Contactar soporte",
        "loading": "Cargando…",
        "error": {
          "title": "Algo salió mal",
          "unexpected": "Error inesperado. Reintenta o contacta soporte."
        }
      }
    }
    ```

    `en.json` ships as a development fallback only — the active locale is always `es-CO`. Missing keys in `es-CO` fall back to `en` so a half-translated page renders English instead of an empty label.

    ### 7.8 Folder-rule enforcement

    `eslint-plugin-boundaries` (added in tasks) enforces:

    - `pages/*` may import from `organisms/`, `molecules/`, `atoms/`, `stores/`, `services/`, `i18n/`, `templates/`. **Never** another page.
    - `organisms/*` may import from `molecules/`, `atoms/`, `stores/`, `services/`, `i18n/`. **Never** from `pages/`.
    - `molecules/*` may import from `atoms/` only.
    - `atoms/*` import from no other component folder.
    - `stores/*` may import from `services/` and `i18n/` only.

    This is the same rule the backend applies on `interface → application → domain ← infrastructure`; the frontend mirror keeps the rendering hierarchy explicit.

    ---

## 8. Frontend visual direction

    > **Frontend-design rules adopted (cited inline at each decision below):**
    >
    > - **Ground it in the subject** — the subject is a single-operator Colombian retail inventory control panel; the page's job is dense, scannable data tables. The visual language must respect that density instead of decorating it.
    > - **Typography carries the personality** — display + body share Inter for cohesion (no serif/sans contrast theatre), with JetBrains Mono for SKUs, quantities, and codes. Type scale is restrained (1.25 ratio).
    > - **Structure is information** — no decorative 01/02/03 numerals; no hairline rule theatre; the SKU, the stock number, and the status badge are the actual structure. Borders exist where data separates from data, not for layout cosmetics.
    > - **Restraint and self-critique** — one memorable choice (the stock number as the typographic hero), everything else quiet and disciplined.
    > - **Active voice, name by what people control** — Spanish UI labels are imperative verbs and concrete nouns ("Crear orden", "Marcar recibida", "Stock mínimo"), never abstractions.
    > - **No templated defaults** — this is not the warm-cream / terracotta look, not the near-black + acid-green look, not the broadsheet / hairline-rules look. It is a deliberate "calm utilitarian density".

    ### 8.1 Aesthetic direction (1 sentence + 3 written references)

    **Calm utilitarian density: think Linear meets a paper inventory clipboard.** Wide spacing, generous borders, restrained color, never decorative. The page earns its density — it shows the operator many rows of real product data — but never crowds the eye.

    Three written references that anchor the direction:

    - **a) Linear** — clean admin tables on a near-white surface, a single calm cobalt accent for interactive elements, status badges that read at a glance, generous row height (~48px). We borrow the table density and the single-accent rule.
    - **b) Vercel storage dashboards** — restrained typography, small-caps numerals for stats, hairline borders between rows, no drop shadows on cards (only a single `--shadow-sm` to lift tables off the background). We borrow the typographic discipline.
    - **c) A physical inventory clipboard** — scannable, hand-numbered, monospace SKUs in the left column. We borrow the monospace SKU treatment and the "every column has a job" attitude.

    ### 8.2 Color palette (intent + tokens)

    All tokens are `oklch()` for perceptual uniformity and CSS-native authoring. Defined in `packages/frontend/src/styles/tokens.css` and consumed by Tailwind via `tailwind.config.ts → theme.extend.colors`.

    | Token | Value | Intent |
    | --- | --- | --- |
    | `--color-primary` | `oklch(0.55 0.13 245)` (calm cobalt) | Interactive elements and primary actions. Signals "click here" without screaming. |
    | `--color-primary-hover` | `oklch(0.48 0.14 245)` | Hover/active state of primary actions. |
    | `--color-surface` | `oklch(0.99 0 0)` | Page background. Near-white but not sterile; lets the cards float subtly above. |
    | `--color-card` | `oklch(1 0 0)` | Elevated panels (tables, cards). One step brighter than surface. |
    | `--color-success` | `oklch(0.62 0.13 145)` | Receipt confirmation, alert resolved, ENTRADA movement badge. |
    | `--color-warning` | `oklch(0.78 0.13 75)` | Pending orders, low-stock heads-up. Never red — amber. |
    | `--color-danger` | `oklch(0.55 0.18 25)` | Destructive actions, out-of-stock, errors. Reserved; never decorative. |
    | `--color-muted` | `oklch(0.55 0.005 260)` | Borders, dividers, secondary text. Carries the structural weight of the layout. |
    | `--color-text` | `oklch(0.20 0.005 260)` | Body and headings. High contrast but not pure black. |
    | `--color-text-muted` | `oklch(0.45 0.005 260)` | Labels, captions, metadata. |

    Status badges map onto these tokens deterministically:

    - `OK` (stock > stockMin × 2) → `--color-success` background, `--color-card` text.
    - `Warning` (stockMin < stock ≤ stockMin × 2) → `--color-warning` background, `--color-text` text.
    - `Danger` (stock = 0 or stock ≤ stockMin) → `--color-danger` background, `--color-card` text.

    ### 8.3 Typography

    - **Font family (display + body):** `'Inter Variable', 'Inter', system-ui, sans-serif`. Loaded via `@fontsource-variable/inter`. One face for everything; the personality comes from weight + size, not from a contrast face.
    - **Mono (codes + numbers):** `'JetBrains Mono Variable', ui-monospace, monospace`. Loaded via `@fontsource-variable/jetbrains-mono`. Reserved for SKUs, qty values, currency, request IDs, and the stock number in the products list.
    - **Base size:** 14px. Tailwind's `text-sm` maps to `0.875rem` (14px) and is the default body size.
    - **Type scale (1.25 ratio):** 12 / 14 / 16 / 18 / 22 / 28 / 36 px. Tailwind classes: `text-xs` … `text-4xl`.
    - **Weights:**
      - `400` (Regular) — body copy.
      - `500` (Medium) — labels, table headers, column titles.
      - `600` (Semibold) — page headings, card titles.
      - `700` (Bold) — reserved for the **stock number** in the products list (the typographic hero of the page).
    - **Numeric figures:** tabular-nums (`font-variant-numeric: tabular-nums`) on every number that aligns in a column (stock, qty, price). JetBrains Mono is inherently tabular.

    ### 8.4 Spacing scale (8-point grid)

    `4 / 8 / 12 / 16 / 24 / 32 / 48 px`. Tailwind's default scale covers this. Restated here as a commitment: every margin, padding, and gap is a multiple of 4px. No 6px, no 10px, no "magic" 7px.

    ### 8.5 Component style

    - **Border radius:**
      - Atoms (button, input, badge): `6px`.
      - Cards (table containers, alert card, order detail card): `10px`.
      - Modals and dropdowns: `16px`.
    - **Shadow (two steps, deliberately):**
      - `--shadow-sm`: `0 1px 2px oklch(0 0 0 / 0.06)` — cards, table containers.
      - `--shadow-lg`: `0 8px 24px oklch(0 0 0 / 0.10)` — modals, dropdowns, command palette.
    - **Motion:**
      - Hover transitions: `120ms ease-out`.
      - State transitions (button click, badge change, form submit): `200ms ease-out`.
      - Layout shifts (drawer open, modal in): `320ms cubic-bezier(0.16, 1, 0.3, 1)` (gentle deceleration).
      - **`prefers-reduced-motion: reduce`** → durations collapse to `0ms`; layout shifts still happen, but instantly. Implemented in `tokens.css` via `@media (prefers-reduced-motion: reduce)`.
    - **Borders:** `1px solid var(--color-muted)`. Buttons and inputs are **always bordered** — never borderless. Borderless inputs look modern in screenshots and are unusable in a 14-candle-power office with sun glare on the monitor.

    ### 8.6 Hero page wireframe — products list (`/productos`)

    ```
    ┌────────────────────────────────────────────────────────────────────────────────┐
    │  MercadoExpress    ● Sincronizado                            admin ▼ (Salir)    │  ← top bar (DashboardLayout)
    ├────────────────────────────────────────────────────────────────────────────────┤
    │                                                                                │
    │  Productos                                              [+ Crear producto]     │  ← page header (Molecule)
    │                                                                                │
    │  ┌────────────────────────────────────────────────────────────────────────┐    │
    │  │  Categoría: [Todas ▼]   Proveedor: [Todos ▼]   ☐ Con alerta activa     │    │  ← filter strip (Molecule)
    │  │  Stock: [ mín ][ máx ]                                                  │    │
    │  └────────────────────────────────────────────────────────────────────────┘    │
    │                                                                                │
    │  ┌────┬────────────────────────────┬────────────┬─────────┬─────────┬────────┐  │
    │  │SKU │ Nombre                     │ Categoría  │  Stock  │ Mín.    │ Estado │  │  ← table (Organism)
    │  │    │                            │            │         │         │        │  │
    │  │    │  weight 500                │  badge     │ weight  │ muted   │ badge  │  │
    │  ├────┼────────────────────────────┼────────────┼─────────┼─────────┼────────┤  │
    │  │BEB-│ Agua Mineral 500ml         │ Bebidas    │   120   │   50    │  OK    │  │     - SKU in JetBrains Mono
    │  │ 001│                            │            │         │         │        │  │     - Stock in Mono, weight 700
    │  ├────┼────────────────────────────┼────────────┼─────────┼─────────┼────────┤  │
    │  │BEB-│ Gaseosa Cola 1.5L          │ Bebidas    │    28   │   60    │ ⚠ Warn │  │     - Name weight 500, truncate
    │  │ 002│                            │            │         │         │        │  │     - Estado is a colored pill
    │  ├────┼────────────────────────────┼────────────┼─────────┼─────────┼────────┤  │
    │  │LAC-│ Leche Entera 1L            │ Lácteos    │     0   │   40    │ ✕ Out  │  │
    │  │ 001│                            │            │         │         │        │  │
    │  └────┴────────────────────────────┴────────────┴─────────┴─────────┴────────┘  │
    │                                                                                │
    │  Mostrando 1–20 de 142                                  ‹ 1 2 3 … 8 ›          │  ← pagination footer
    │                                                                                │
    └────────────────────────────────────────────────────────────────────────────────┘
    ```

    The wireframe encodes every visual decision in this section: monospace SKUs, large mono stock numbers, status badges driven by `--color-success/--color-warning/--color-danger`, generous row height (48px), single-accent primary action (`+ Crear producto`), filter strip as a bordered molecule, no shadows on the table, no decorative chrome.

    ### 8.7 Empty / loading / error conventions

    - **Empty state** (e.g. no products yet): centered icon (`IconBox` atom, size 32) + Spanish copy + primary CTA. Example:
      > `🗋`  · *No hay productos todavía. Crea el primero.*  · `[+ Crear producto]`

      The copy names the action and the outcome ("Crea el primero"), not the system ("Your inventory is empty").

    - **Loading state:** **skeleton rows** matching the table layout — three filled bars for SKU/Name/Category, one taller bar for Stock, one short bar for Min, one pill-shaped bar for Status. No spinner inside tables (the eye must remain on the column headers). A spinner is reserved for full-page transitions (route changes) and form submissions.

    - **Error state:** red banner at the top of the affected region. The banner carries:
      - The `code` from the backend `ErrorCode` registry (e.g. `SKU_ALREADY_EXISTS`).
      - The Spanish `message` already returned by the backend, or a frontend-defined friendly fallback if the backend omits one.
      - One action button:
        - **`Reintentar`** if the error is retryable (network, 5xx, `INTERNAL_ERROR`).
        - **`Contactar soporte`** if the error is non-retryable (validation, business-rule, 409, 422).

      The retry/suppport decision is encoded by a small helper:

      ```ts
      // packages/frontend/src/composables/useErrorRecovery.ts
      import type { ErrorCode } from '@mercadoexpress/shared/errors';
      const RETRYABLE: ReadonlyArray<ErrorCode> = ['INTERNAL_ERROR', 'NETWORK_ERROR', 'TIMEOUT'];
      export function useErrorRecovery() {
        return {
          isRetryable: (code: ErrorCode) => RETRYABLE.includes(code),
          actionLabel: (code: ErrorCode) => (RETRYABLE.includes(code) ? 'Reintentar' : 'Contactar soporte'),
        };
      }
      ```

      Errors do not apologize and do not say "Something went wrong" — they name the code and the next step. (Per frontend-design rule: "Errors don't apologize, and they are never vague about what happened.")

    ### 8.8 Dark mode

    Defer to v2. Out of scope for this change (see §16). The token system in `tokens.css` is structured so a `[data-theme='dark']` override block is a one-file change later — no component code touches raw color values; everything goes through the CSS custom properties.

    ### 8.9 Accessibility baseline

    - Visible keyboard focus on every interactive atom (2px solid `--color-primary` ring at 2px offset, never removed).
    - Every form input has an associated `<label>` (not just `placeholder`).
    - Every status badge has an `aria-label` describing the state in full ("Stock bajo — el stock actual está por debajo del mínimo").
    - Color is never the sole signal: every status badge also carries an icon or text prefix (`✓ OK`, `⚠ Advertencia`, `✕ Sin stock`).
    - Contrast: all text-on-background combinations meet WCAG AA at the chosen token values; verified by a Vitest + `@axe-core/playwright` smoke check on the dashboard layout.

    ---

## 9. API surface (BACKEND portion)

    All routes are mounted under `/api/v1`. JWT middleware (`packages/backend/src/shared/jwt-middleware.ts`) is applied to every route **except** `POST /auth/login`. Routes are wired in `packages/infra/src/stacks/ApiStack.ts` (out of scope for this design file; documented in `infra/design.md`). Every route on `auth-lambda`, `products-lambda`, `inventory-lambda`, `alerts-lambda`, `orders-lambda` accepts the Bearer token and rejects missing tokens with `401`. The CORS `OPTIONS` preflight is handled by API Gateway **before** the request reaches any Lambda handler — see §15.2.3 for the `corsPreflight` configuration (allowOrigins, allowHeaders, allowMethods, allowCredentials=false, maxAge=1h).

    | Method | Path | Lambda | Handler module | DTO schema path |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | auth-lambda | `auth/interface/handlers/login.ts` | `packages/shared/src/schemas/auth/login-request.ts`, `login-response.ts` |
| GET | `/api/v1/categories` | categories-lambda (within products-lambda) | `categories/interface/handlers/list-categories.ts` | `packages/shared/src/schemas/categories/list-categories.ts` |
| POST | `/api/v1/categories` | categories-lambda | `categories/interface/handlers/create-category.ts` | `packages/shared/src/schemas/categories/category.ts` |
| POST | `/api/v1/products` | products-lambda | `products/interface/handlers/create-product.ts` | `packages/shared/src/schemas/products/create-product.ts`, `product.ts` |
| GET | `/api/v1/products` | products-lambda | `products/interface/handlers/list-products.ts` | `packages/shared/src/schemas/products/list-products.ts` |
| GET | `/api/v1/products/{id}` | products-lambda | `products/interface/handlers/get-product.ts` | `packages/shared/src/schemas/products/product.ts` |
| PATCH | `/api/v1/products/{id}` | products-lambda | `products/interface/handlers/update-product.ts` | `packages/shared/src/schemas/products/update-product.ts` |
| POST | `/api/v1/products/{id}/movements` | inventory-lambda | `inventory/interface/handlers/record-movement.ts` | `packages/shared/src/schemas/inventory/create-movement.ts`, `movement.ts` |
| GET | `/api/v1/products/{id}/movements` | inventory-lambda | `inventory/interface/handlers/list-movements.ts` | `packages/shared/src/schemas/inventory/list-movements.ts` |
| GET | `/api/v1/alerts` | alerts-lambda | `alerts/interface/handlers/list-alerts.ts` | `packages/shared/src/schemas/alerts/list-alerts.ts` |
| GET | `/api/v1/alerts/{id}` | alerts-lambda | `alerts/interface/handlers/get-alert.ts` | `packages/shared/src/schemas/alerts/alert.ts` |
| POST | `/api/v1/orders` | orders-lambda | `orders/interface/handlers/create-order.ts` | `packages/shared/src/schemas/orders/create-order.ts`, `order.ts` |
| GET | `/api/v1/orders` | orders-lambda | `orders/interface/handlers/list-orders.ts` | `packages/shared/src/schemas/orders/list-orders.ts` |
| GET | `/api/v1/orders/{id}` | orders-lambda | `orders/interface/handlers/get-order.ts` | `packages/shared/src/schemas/orders/order.ts` |
| POST | `/api/v1/orders/{id}/approve` | orders-lambda | `orders/interface/handlers/approve-order.ts` | `packages/shared/src/schemas/orders/approve-order.ts` |
| POST | `/api/v1/orders/{id}/reject` | orders-lambda | `orders/interface/handlers/reject-order.ts` | `packages/shared/src/schemas/orders/reject-order.ts` |
| POST | `/api/v1/orders/{id}/receive` | orders-lambda | `orders/interface/handlers/receive-order.ts` | `packages/shared/src/schemas/orders/receive-order.ts` |

### 9.1 Cross-cutting middleware

| Middleware | Applied to | Source |
| --- | --- | --- |
| `jwtMiddleware` | every route except `POST /auth/login` | `packages/backend/src/shared/jwt-middleware.ts` |
| `requestIdMiddleware` | every route (generates UUID v4 if missing; echoes `X-Request-Id`) | `packages/backend/src/shared/request-context.ts` |
| `errorMapper` | every route (translates domain errors to envelope) | `packages/backend/src/shared/error-mapper.ts` |
| `idempotencyKey` (optional header) | `POST /products`, `POST /products/{id}/movements`, `POST /orders`, `POST /orders/{id}/{approve,reject,receive}` | `packages/backend/src/shared/idempotency-key.ts` |

### 9.2 Common response envelopes

Defined in `packages/shared/src/schemas/common/`:

- `error-envelope.ts` → `{ code, message, details? }` for every 4xx/5xx.
- `page.ts` → `{ items, page, size, total, hasMore }` for every list endpoint.
- `idempotency-key.ts` → schema + behavior for the `Idempotency-Key` header.
- `error-code.ts` → string-literal union matching `packages/shared/src/errors/errorCodes.ts`.

---

## 10. Migrations & seed (D5)

### 10.1 CDK CustomResource chain

````

cdk deploy ApiStack
└─► CustomResource "PrismaMigrateAndSeed"
│
├─► 1. handler = MigrateLambda (NodejsFunction)
│ runs: npx prisma migrate deploy
│ env: DATABASE_URL ← from SSM (one rotation per stage)
│ waits for exit code 0
│
└─► 2. (same invocation, after migration OK) runs:
npx tsx prisma/seed.ts
env: DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD
exits 0 → CustomResource signals SUCCESS
exits non-zero → CustomResource signals FAILED, stack rolls back

```

The CustomResource handler is in `packages/infra/src/constructs/prisma-migrate-and-seed.ts` (infra design). The migration + seed command itself runs in `packages/backend/scripts/migrate-and-seed.ts` (bundled into the Lambda by CDK). On stack **update**, the same CustomResource runs again — `prisma migrate deploy` is additive-only in this change, and the seed is fully idempotent (see §10.3).

### 10.2 Seed contents

`packages/backend/prisma/seed.ts` upserts in this order (FK-safe):

1. **Admin user** — keyed on `username = "admin"` (configurable via `ADMIN_USERNAME`).
   - `password_hash` = `bcrypt.hash(ADMIN_PASSWORD, 10)` (D6).
   - `email` = `ADMIN_EMAIL` (default `admin@mercadoexpress.local`).
   - `role` = `admin` (the only role in MVP).
2. **Six reference categories** from `porject.md → Datos de Referencia`, keyed on `name`:
   `Bebidas`, `Lácteos`, `Snacks`, `Limpieza`, `Frutas`, `Granos`.
3. **Six reference products**, keyed on `sku`:
   - `BEB-001` Bebidas / Agua Mineral 500ml
   - `BEB-002` Bebidas / Gaseosa Cola 1.5L
   - `LAC-001` Lácteos / Leche Entera 1L
   - `LAC-002` Lácteos / Queso Campesino 500g
   - `SNK-001` Snacks / Papas Fritas 150g
   - `LIM-001` Limpieza / Detergente 1kg
   - Each with `price` (integer COP), `stock = 0`, `stock_min` (per `porject.md`), `supplier` string.

### 10.3 Idempotency

Every write is an `upsert` keyed on a stable identifier:

| Table | Key | Re-run behavior |
| --- | --- | --- |
| `users` | `username` | existing row's `password_hash`, `email`, `role` updated in place |
| `categories` | `name` | no-op if name exists; inserts if missing |
| `products` | `sku` | updates mutable fields (`price`, `stock_min`, `supplier`); never `stock` (movements own stock) |

The seed is wrapped in `try/catch` that logs and re-throws on any non-conflict error so a partially-seeded DB never happens in production.

### 10.4 Local dev (parity)

`pnpm db:migrate` and `pnpm db:seed` scripts in `packages/backend/package.json` run the same commands against the Docker Compose Postgres (R-10 mitigation). CI uses the same commands against an ephemeral Postgres service container (see §11).

---

## 11. CI/CD pipeline (BACKEND portion)

### 11.1 `.github/workflows/ci.yml` (every PR)

| Job | Command | Working dir | Notes |
| --- | --- | --- | --- |
| `install` | `pnpm install --frozen-lockfile` | repo root | one cache for the workspace |
| `type-check` | `pnpm -r tsc --noEmit` | repo root | catches boundary violations across all packages |
| `lint` | `pnpm -r eslint` | repo root | flat config; `eslint-plugin-boundaries` enforces layering |
| `unit-tests` | `pnpm -r vitest run` | repo root | with `--coverage` for the backend; 80% gate for `domain/` + `application/` (config.yaml) |
| `e2e` | `pnpm -w playwright test` | repo root | against a docker-compose stack spun up in the job |
| `build-cdk` | `cdk synth` | `packages/infra` | catches missing constructs early |

Triggers: `pull_request` to `main` and `push` to `feat/*` branches.

### 11.2 `.github/workflows/deploy-dev.yml` (push to main)

| Step | Command | Notes |
| --- | --- | --- |
| checkout | `actions/checkout@v4` | full history (CDK needs `git describe`) |
| setup-node | `actions/setup-node@v4` with `node-version: 20` | matches Lambda runtime |
| setup-pnpm | `pnpm/action-setup@v3` | version from `packageManager` field |
| install | `pnpm install --frozen-lockfile` | |
| build-backend | `pnpm --filter backend build` | emits Lambda bundles for the CDK synth step |
| build-shared | `pnpm --filter shared build` | emits `.d.ts` for the backend |
| cdk-synth | `pnpm --filter infra synth` | dry-run, fails fast on construct errors |
| configure-aws | `aws-actions/configure-aws-credentials@v4` with `role-to-assume: arn:aws:iam::…:role/github-actions-dev` | OIDC, no static keys (`config.yaml → infra.ci`) |
| cdk-deploy | `cdk deploy -c stage=dev MercadoExpress-dev --require-approval never` | one stack; sequential: `DatabaseStack` → `ApiStack` → `FrontendStack` |
| post-deploy | write `dev-url.txt` artifact | output: API URL + CloudFront URL |

The seed/migration CustomResource runs **inside** `cdk deploy` as part of `ApiStack`. Deploy failure = the workflow job exits non-zero and the prior stack stays in service (§11 of the proposal).

### 11.3 Out of scope (documented, not built)

- `deploy-prod.yml` is scaffolded but not exercised. Manual approval step is present in the file; the workflow is disabled by a `if: false` guard. Tag-based prod deploy lands in the next iteration.

### 11.4 E2E scenario inventory (Playwright)

The Playwright suite lives at `packages/e2e/tests/` and runs against the docker-compose stack in CI and against the deployed dev URL after each deploy to `main`. Every scenario maps to one or more BR / D / RISK entries. New scenarios land in this section before being added to a PR.

| Scenario | Maps to | Setup |
| --- | --- | --- |
| "SPA on CloudFront reaches API Gateway (CORS preflight)" — opens the SPA origin in headless Chrome, fires `OPTIONS ${API_BASE}/api/v1/products` with `Origin: <cloudfront-url>` and `Access-Control-Request-Headers: authorization`, asserts the response carries `Access-Control-Allow-Origin` matching the SPA origin and `Access-Control-Allow-Headers` containing `authorization` | RISK-002 | Dev stage only; the dev URL is set in `packages/e2e/playwright.config.ts → baseURL` |
| (TBD — scenario catalogue to grow during `sdd-tasks`) | — | — |

---

## 12. Observability (BACKEND portion)

### 12.1 Structured logger

- Library: `pino` (chosen in proposal §7.2). One shared `Logger` factory in `packages/backend/src/shared/logger.ts` constructs a child logger per request with `requestId`, `userId`, `bc`, `route` bound up front.
- Output: `stdout` (Lambda default → CloudWatch Logs). No extra transport packages.

### 12.2 Mandatory log fields

Every log line for an HTTP request carries:

| Field | Source | Example |
| --- | --- | --- |
| `requestId` | inbound `X-Request-Id` or generated UUID v4 | `"8b4f2a3e-…"` |
| `userId` | JWT `sub` (post middleware) | `"u-uuid"` |
| `bc` | bound at bootstrap from Lambda name | `"auth"`, `"orders"` |
| `route` | `event.routeKey` | `"POST /api/v1/auth/login"` |
| `latencyMs` | measured around the handler | `42` |
| `outcome` | `"ok"` \| error code | `"ok"`, `"INVALID_CREDENTIALS"`, `"INTERNAL_ERROR"` |

### 12.3 CloudWatch configuration

- One log group per Lambda: `/aws/lambda/MercadoExpress-{stage}-{bc}`.
- Retention: **7 days** (Q-A7). Cost-motivated; the dev stage sees burst traffic only and the data is short-lived by intent. Production hardening (30+ days) is a follow-up.
- Metric filters: any log line where `level == "error"` emits the `LambdaErrors` CloudWatch metric (count).
- Default JSON keys exposed as dimensions: `bc`, `outcome`.

### 12.4 Alarms (Q-A7)

| Alarm | Metric | Threshold | Period | Action |
| --- | --- | --- | --- | --- |
| LambdaErrors | `LambdaErrors` per Lambda | `> 0` | 5 min | SNS topic → email to ops (dev: only on `auth-lambda` and `orders-lambda`; others are observational) |
| ThrottleAlarm | Lambda `Throttles` per Lambda | `> 0` | 5 min | same SNS topic |
| ConcurrentExecution | Lambda `ConcurrentExecutions` per Lambda | `> 80%` of reserved concurrency | 5 min | same SNS topic |

Reserved concurrency is left at default (unreserved) in dev to avoid false alarms on cold start; the 80% threshold becomes meaningful once reserved concurrency is set (infra-design ADR territory, not this file).

### 12.5 Explicitly out of scope

- **X-Ray tracing** is skipped for MVP. Cost: per-trace ingestion + per-Lambda overhead. The proposal calls this out as a non-goal; a `tracing: optional` flag in the bootstrap is a one-liner when we turn it on.
- **Dashboards** beyond the default alarms: out of scope (proposal §9).

---

## 13. ADR list (BACKEND ADRs only)

### ADR-1 (Q-A1): Cross-BC reaction = direct collaborator ports + one Prisma `$transaction` for the receive flow

- **Status:** Accepted
- **Context:** The orders-receive flow must atomically (a) flip the order to `RECIBIDA`, (b) write the `ENTRADA` stock movement, (c) update `Product.stock`, and (d) close any active alert when the new stock strictly exceeds `stockMin` (OR-7 + BR-3 + BR-4). Two viable mechanisms: (1) an in-process event bus, (2) direct collaborator ports called from `orders-lambda` inside a single Prisma `$transaction`. We must pick one and document why.
- **Decision:** Direct collaborator ports inside one Prisma `$transaction`. `orders-lambda` calls `ProductStockGate.txIncrementStock` and `AlertCloserPort.txCloseIfOpenAndAboveMin`, both implemented to accept the active Prisma transaction handle.
- **Consequences (good):**
  - OR-7 atomicity is enforced by the database, not by application-level retry. One commit, one rollback.
  - BR-3 + BR-4 are observed at the same DB snapshot the order update wrote — no TOCTOU window.
  - No new infrastructure (no EventBridge, no SNS, no SQS) for the MVP. Cheapest cost path.
  - The "one Prisma `$transaction` = one BC's responsibility" rule is preserved (no cross-DB joins, no foreign writes).
  - Easy to test with the same `prisma.$transaction` pattern used elsewhere; one integration test asserts the four writes commit together.
- **Consequences (bad):**
  - The seam between `orders` and the other two BCs is a shared `prisma` client, not a contract. Renaming a column in `products` is now a three-BC coordinated change.
  - The `ProductStockGate` / `AlertCloserPort` interfaces live in two BCs that are physically the same repo. Drift is possible if not carefully versioned.
  - We are committing now to swap to EventBridge later (v2), which means re-doing this orchestration.
- **Mitigations for the bad:**
  - The ports are owned by the *provider* BC (`inventory` owns `ProductStockGate`, `alerts` owns `AlertCloserPort`). Consumers (`orders`) depend on the port, not the implementation. Versioned via semver of the `packages/shared` types.
  - `prisma migrate deploy` is the only schema-evolution channel; PRs that rename a column must update all three BCs in the same change. The PR template will include a checklist.
  - The in-process `EventBus` is still present for the *create-side* low-stock path (no atomicity required), so the eventual v2 swap touches only the receive use case.
  - One Vitest integration test ("orders.receive.commit-or-rollback") fires a forced failure between step 2 and step 3 and asserts the order is still `APROBADA`, no movement row, no stock change, no alert mutation.
  - The same direct-port + `$transaction` mechanic is reused for the **manual `ENTRADA` recovery path** in §6.3 step 6 (`StockMutationService` calls `AlertCloserPort` directly inside its `$transaction`). See `reviews/risk-review.md` RISK-001 for the rationale: an in-process event bus is per-process and invisible across separate Lambdas, so the bus is **not** used for this seam either.

  Additional Vitest integration tests carried for the manual-ENTRADA recovery path:
  - "Manual ENTRADA above stockMin closes active alert (BR-3 recovery)" — fires a `SALIDA` to cross below `stockMin`, asserts an `ACTIVA` row exists; then fires an `ENTRADA` that raises `newStock > stockMin`; asserts the alert row flips to `RESUELTA` with `resolved_at` set. Mirrors the US-4 acceptance scenario.
  - "Movement failure rolls back alert close" — stubs `AlertCloserPort.txCloseIfOpenAndAboveMin` to throw after the `StockMovement` insert; asserts no movement is persisted and no alert mutation occurs (single `$transaction` rolls back).

### ADR-2 (Q-A2): Concurrent `SALIDA` = pessimistic `SELECT ... FOR UPDATE` on `products`

- **Status:** Accepted
- **Context:** Two concurrent `SALIDA` movements on the same product could each read `stock = 10`, each compute `newStock = 10 - qty`, and both commit — silently over-selling stock. This is R-2, the highest-severity correctness risk. We must pick one of: (a) optimistic version column on `products`, (b) `Serializable` isolation, (c) `SELECT ... FOR UPDATE` row lock.
- **Decision:** Pessimistic row lock via `prisma.$queryRaw\`SELECT id, stock, stock_min FROM products WHERE id = $1::uuid FOR UPDATE\`` inside the mutation transaction. Isolation level: default `ReadCommitted`.
- **Consequences (good):**
  - BR-1 is enforced by Postgres itself, not by application-level retry. The second writer waits on the row lock; its subsequent read sees the new stock and either succeeds or rejects with `STOCK_WOULD_GO_NEGATIVE`.
  - The lock is scoped to one row, not the whole table. Non-stock product updates (`PATCH /products/{id}` updating `supplier`) are not blocked.
  - No schema change to `products`. No version column, no migration, no read round-trip.
  - The same `FOR UPDATE` is reused by the receive flow (§5), so there is one concurrency model, not two.
- **Consequences (bad):**
  - Two writers on the same product serialize. Burst edits to the same SKU will queue. Acceptable for MVP (one operator, manual edits); bad for high-throughput automation.
  - We are using `$queryRaw` for one operation, breaking the pure-Prisma idiom. Slight cost in readability and in the ability to use Prisma's auto-generated types for that one statement.
  - Deadlock is possible if two txs lock rows in different orders. Mitigated by always locking the `products` row first inside the mutation tx (single-row lock order).
- **Mitigations for the bad:**
  - Throughput ceiling is documented; the proposal's R-2 mitigation calls out the Playwright concurrent-adjustment scenario, which proves correctness under contention.
  - `$queryRaw` is wrapped in a typed helper in `StockMutationService` so the raw SQL appears once. The `inventory/.../stock-mutation-service.test.ts` unit test exercises the helper with a stubbed `prisma.$queryRaw` and asserts the row-lock call shape.
  - Single-row lock order is documented at the top of `stock-mutation-service.ts`; code review checklist enforces it.
  - One Vitest integration test ("concurrent SALIDA serializes") fires two `SALIDA` requests in parallel against a `stock = 5` product and asserts exactly one succeeds and one gets `STOCK_WOULD_GO_NEGATIVE`.

### ADR-3 (Q-A3): Receive transactionality = single `prisma.$transaction` covering order + movement + stock + alert

- **Status:** Accepted
- **Context:** The receive flow writes across four tables (`purchase_orders`, `stock_movements`, `products`, optionally `alerts`). The spec mandates "all-or-nothing" (BR-D4, OR-7). We need to lock down: (a) which transaction primitive, (b) which order of operations inside the tx, (c) which isolation level.
- **Decision:** Single `prisma.$transaction(async (tx) => { … })` with the operations in this order: (1) `orders.order-repository.txUpdate(id, status='RECIBIDA')`, (2) `inventory.ProductStockGate.txIncrementStock(productId, +qty, reason, userId)` which itself does `SELECT … FOR UPDATE` + insert movement + update stock, (3) `alerts.AlertCloserPort.txCloseIfOpenAndAboveMin(productId, newStock, stockMin)`. Isolation level: `ReadCommitted`.
- **Consequences (good):**
  - The order update is the *first* write. If it fails (wrong status, order not found), no stock or alert work happens.
  - The stock mutation re-locks the product row inside the same tx (Q-A2). It also reads the current `stock_min` for the alert close — fresh, not stale.
  - The alert close is the *last* write. If the alert table throws a transient error, the entire tx rolls back including the stock update. No half-state.
  - `ReadCommitted` is enough because the only invariant we care about (BR-1) is enforced by `SELECT … FOR UPDATE`. `Serializable` would block unrelated writes to `products` and add no correctness here.
  - The `OrderReceived` event is emitted **after** the tx commits, never inside it. If the emit fails, the DB is still consistent; the alerts path is the safety net.
- **Consequences (bad):**
  - A long tx holds the product row lock; manual `SALIDA` against the same product during a receive will queue. Acceptable for MVP.
  - The same `prisma` client is shared across three BCs (a deliberate, ADR-1 choice). The tx boundary is invisible to the BC code; a developer unfamiliar with the rule could accidentally nest a write outside the supplied `tx`.
  - The four writes are coupled by order. Reordering breaks correctness (e.g. closing the alert before the stock update would close on stale `newStock`).
- **Mitigations for the bad:**
  - The `txUpdate` / `txIncrementStock` / `txCloseIfOpenAndAboveMin` port methods are the **only** public write path on the repositories used by `orders`. Any other write attempt is a code review red flag.
  - The ordering is documented in a comment block at the top of `ReceiveOrderUseCase.execute()`; the integration test asserts the order via spies.
  - `prisma.$transaction` defaults to a single connection, so deadlock-by-cycle is impossible in this flow (only one connection involved).
  - One Vitest integration test ("receive rolls back on movement failure") stubs `ProductStockGate.txIncrementStock` to throw and asserts the order is still `APROBADA` and no movement row exists.
      - Duplicate `POST /receive` is blocked by the order state machine (`RECIBIDA` → `409 ORDER_INVALID_TRANSITION`), **not** by `Idempotency-Key`. The `Idempotency-Key` middleware sits in front of the handler; the state-machine guard is the authoritative duplicate defense. (RISK-W07)

### ADR-4 (Q-A4): `MovementType` storage = Postgres native `ENUM`

- **Status:** Accepted
- **Context:** We must choose between Postgres `ENUM` and `VARCHAR + CHECK` for the `stock_movements.type` column. The decision affects Prisma client shape, migration story, and test ergonomics (SQLite-in-tests concern noted in the proposal).
- **Decision:** Postgres native `ENUM` named `movement_type` with values `('ENTRADA', 'SALIDA')`. Prisma maps it as a string union; the application uses the TypeScript `MovementType` value object everywhere.
- **Consequences (good):**
  - The DB rejects any value outside the two at the storage layer. No way to write a typo (`"ENTRADAS"`) even from a misconfigured Lambda.
  - Prisma's generated client types are tightened to `'ENTRADA' | 'SALIDA'`. The application cannot pass an arbitrary string.
  - Storage is compact (4 bytes vs varchar length overhead); index scans on `type` are faster.
  - Adding a third value (e.g. `'AJUSTE'`) is a one-line `ALTER TYPE ADD VALUE` migration, no application code change beyond the union type.
- **Consequences (bad):**
  - Adding an enum value is a Postgres `ALTER TYPE … ADD VALUE` which cannot run inside a transaction block in some PG versions. This is a one-time-per-add concern, not a hot-path one.
  - SQLite-in-tests is moot for the MVP — we use Postgres everywhere (local Docker + CI service container + RDS). If we ever want SQLite for fast unit tests, the `ENUM` would need a `VARCHAR` fallback adapter. Not done now.
  - Cross-BC consumers (none yet) must know the string values by convention; the `shared` package exports the `MovementType` value object so the strings are typed on both ends.
- **Mitigations for the bad:**
  - Migrations that add enum values are run by `prisma migrate deploy` in the CustomResource Lambda, which does not wrap them in a user transaction. Documented in `packages/backend/prisma/README.md`.
  - The `MovementType` value object lives in `packages/shared/src/domain/movement-type.ts` and is the **only** place the strings are spelled. Backend and frontend import from there.
  - One Vitest test ("movement type rejects bad value") attempts a raw `INSERT` with a third value and asserts the DB rejects it.

### ADR-7 (Q-A7): CloudWatch retention = 7 days; alarms on ERROR + throttles + 80% concurrency

- **Status:** Accepted
- **Context:** CloudWatch Logs cost scales with retention × ingested bytes. Free-tier retention is unlimited-days-on-5GB; beyond that we pay per GB-month. The proposal lists "7 days" as a target but did not lock it. We also need a default alarm policy.
- **Decision:** 7-day retention on every Lambda log group. Three alarms per Lambda:
  1. `LambdaErrors` (`level=error` filter) `> 0` over 5 min → SNS.
  2. Lambda `Throttles` `> 0` over 5 min → SNS.
  3. Lambda `ConcurrentExecutions` `> 80%` of reserved concurrency over 5 min → SNS.
- **Consequences (good):**
  - Cost is bounded; we never accidentally keep a year's worth of `info` logs.
  - The two operational alarms (errors, throttles) catch the two most common production incidents without needing custom dashboards.
  - 80% concurrency threshold gives 4-minute heads-up before throttling kicks in at 100% (default account limit is 1000 concurrent per region; per-Lambda reserved concurrency is set in `infra/design.md`).
  - Alarms are wired by CDK as part of the API stack — no manual console step.
- **Consequences (bad):**
  - 7 days is short. A bug discovered on day 8 has no log evidence. For MVP this is acceptable (the dev stage is the only deploy target and bugs surface in hours, not weeks).
  - The 80% threshold is meaningless if reserved concurrency is unset (the metric is unbounded). The CDK construct in `infra/design.md` sets reserved concurrency per Lambda; until it does, alarm #3 is dormant.
  - The alarms fan out to a single SNS topic with email subscription. A noisy period (e.g. a load test) will spam ops. Documented; not mitigated in MVP.
- **Mitigations for the bad:**
  - The proposal's success criteria already call out "dev stage only"; the cost-driven retention choice is honest about that scope.
  - Infra design ADR-6 (in `infra/design.md`) sets reserved concurrency per Lambda; alarm #3 becomes effective at that point.
  - SNS topic has an `unsubscribe` link in the email; ops can mute a known noisy period without disabling the alarm.
  - One `vitest` test on the CDK construct asserts the log-group retention is `7` days and the three alarm definitions are present.

---

## 14. File-by-file change manifest (BACKEND-ONLY portion)

> **Section ordering note:** §7 (frontend architecture) and §8 (frontend
> visual direction) live between §6 (concurrency) and §9 (API surface)
> in this document. The numbering IS correct; the previous physical
> layout had them at the bottom of the file (between §14 and §15).
> See `<!-- END-FRONTEND-DESIGN -->` at the very bottom for the closing
> marker of the frontend-design block.

**Total backend file target: ~85 files.** Format `path | purpose`. The full inventory (~85 entries, tab-delimited) is persisted in the Engram observation `sdd/add-inventory-mvp/design` for cross-session resume. This section gives the high-level shape and the contract for what MUST exist; the apply phase may add small per-test fixtures without re-opening the design.

### 14.1 High-level shape

| Group | Approx. file count | Layer | Purpose |
| --- | --- | --- | --- |
| `packages/shared/src/` | ~38 | schemas + domain primitives + errors | Zod DTOs, VOs, error codes — imported by backend and frontend |
| `packages/backend/src/shared/` | 8 | cross-BC infra | Prisma client, logger, JWT middleware, request-context, error-mapper, idempotency, base exception, `/healthz` (the `in-process-event-bus` file from earlier drafts is removed in MVP per RISK-001) |
| `packages/backend/src/auth/` | ~22 | BC | `User` aggregate, LoginUseCase, bcrypt/jose adapters, **Postgres-backed rate limiter** (`login_attempts` table — RISK-003), login handler |
| `packages/backend/src/products/` | ~27 | BC | `Product` aggregate, rich-filter read repository, CRUD use cases + handlers, category FK validation |
| `packages/backend/src/inventory/` | ~22 | BC | `StockMovement` aggregate (D1, BR-6 append-only), `StockMutationService` with `$queryRaw` FOR UPDATE, ports, in-process bus |
| `packages/backend/src/alerts/` | ~20 | BC | `Alert` aggregate (BR-4 partial unique), `AlertCloserPort` for direct `$transaction` use by `orders` and `inventory` (no in-process event subscribers in MVP — RISK-001) |
| `packages/backend/src/orders/` | ~32 | BC | `PurchaseOrder` state machine, `ReceiveOrderUseCase` (atomic §5), all transition use cases + handlers |
| `packages/backend/src/categories/` | 9 | BC | `Category` lookup aggregate (D2), list + create handlers (no UI in MVP) |
| `packages/backend/prisma/` + root + tests | ~15 | infra | `schema.prisma`, `seed.ts`, `migrations/`, package config, vitest setup, integration setup, fixture builders |

### 14.2 Per-BC layout (repeated for every BC)

```

src/<bc>/
├── domain/
│ ├── <aggregate>.ts
│ ├── value-objects/ (one file per VO)
│ ├── ports/ (one file per port interface)
│ └── errors/ (one file per typed error)
├── application/
│ ├── <use-case-1>.ts (one file per use case)
│ └── <use-case-N>.ts
├── infrastructure/
│ ├── prisma-<repo>.ts (one adapter per port)
│ └── <provider>-<port>.ts
├── interface/
│ ├── handlers/ (one file per HTTP route)
│ └── schemas/ (re-exports + locale messages)
└── bootstrap.ts (DI wiring for this Lambda)

````

### 14.3 Critical contract files (must exist, names are locked)

| Path | Why it is locked |
| --- | --- |
| `packages/shared/src/errors/error-codes.ts` | single source of truth for every `code` string |
| `packages/shared/src/domain/money.ts` | D4: integer-COP serializer (`Decimal → string → parseInt`) |
| `packages/backend/src/shared/jwt-middleware.ts` | D7 + dual-secret rotation window |
| `packages/backend/src/inventory/application/stock-mutation-service.ts` | Q-A2: `$queryRaw` `SELECT … FOR UPDATE` + tx |
| `packages/backend/src/inventory/domain/ports/product-stock-gate.ts` | Q-A1: cross-BC port shared with `orders` |
| `packages/backend/src/inventory/application/stock-mutation-service.ts` | Q-A2: `$queryRaw` `SELECT … FOR UPDATE` + tx; now also calls `AlertCloserPort` directly for the BR-3 recovery path (RISK-001) |
| `packages/backend/src/alerts/domain/ports/alert-closer-port.ts` | Q-A1: cross-BC port shared with `orders` and `inventory` (RISK-001) |
| `packages/backend/src/alerts/infrastructure/prisma-alert-closer-port.ts` | RISK-001: Postgres adapter for `AlertCloserPort`; partial-unique-safe `UPDATE alerts SET status='RESUELTA' WHERE product_id = $1 AND status = 'ACTIVA' RETURNING id` inside the supplied tx |
| `packages/backend/src/orders/application/receive-order.ts` | Q-A3: single `$transaction` orchestration |
| `packages/backend/src/auth/infrastructure/postgres-rate-limiter.ts` | RISK-003: `PostgresRateLimiter` adapter over the `login_attempts` table; ~50 lines, no new infra |
| `packages/backend/prisma/schema.prisma` | §4: 7 models + 3 enums + partial unique index (`login_attempts` added per RISK-003) |
| `packages/backend/prisma/seed.ts` | D5: idempotent upsert of admin + 6 categories + 6 products |
| `packages/backend/scripts/migrate-and-seed.ts` | CDK CustomResource Lambda entry point |
| `packages/backend/src/<bc>/bootstrap.ts` | one per BC: wires the use cases + ports for the Lambda cold start |

### 14.4 Out of scope for backend (owned by other delegations)

- **Frontend** — Vue 3 components, Pinia stores, Vue Router, i18n, Atomic Design templates/pages, ofetch service wrappers. Designed in the frontend section appended below this marker.
- **Infra** — CDK stacks, API Gateway + Lambda route wiring, RDS + pgvector + extensions, CloudFront, S3, SSM secret rotation hook, CustomResource. Designed in `infra/design.md` (separate delegation).

---

## 15. Infra design

This section resolves Q-A5 and Q-A6 from the proposal §8 open-questions list, and pins the remaining infra knobs that the design must commit to before `sdd-tasks` lays out CDK stacks. It is the frontend-design sibling of §13 (backend ADRs) and shares the same format.

### 15.1 Region + CloudFront domain (Q-A5)

#### 15.1.1 The decision

- **AWS region:** `us-east-1` (N. Virginia).
- **CloudFront alternate domain names (CNAMEs):** **none** for MVP. The SPA ships at `<random>.cloudfront.net` only.
- **TLS:** CloudFront default certificate (`*.cloudfront.net`). **No** ACM certificate provisioned for MVP.
- **Route 53 + custom domain:** deferred to v2.

#### 15.1.2 ADR-8 (Q-A5): Region = `us-east-1`, no custom domain for MVP

- **Status:** Accepted
- **Context:** The MVP is a single-environment, single-tenant deployment. We must pick (a) the AWS region for all resources and (b) whether to attach a custom domain to CloudFront now or defer. Free-tier coverage, RDS extension availability (pgvector), CloudFront default-certificate behavior, and DNS-provisioning time all weigh in.
- **Decision:** All resources land in `us-east-1`. CloudFront uses its default URL and default certificate; no Route 53 record, no ACM cert, no custom domain.
- **Consequences (good):**
  - `us-east-1` has the broadest free-tier coverage (RDS free tier, Lambda free tier, CloudFront free tier, S3 free tier all active without region-specific quotas).
  - pgvector is enabled on RDS Postgres 16 in `us-east-1` (verified by `aws rds describe-db-engine-versions`); no region constraint here, but staying in the default region removes one variable from the smoke test.
  - CloudFront's default certificate is provisioned by AWS with zero work from us; no DNS, no validation, no rotation.
  - Zero DNS setup means zero DNS failure modes in the first deploy.
  - Cost is the cheapest path: no domain registration, no Route 53 hosted zone, no ACM cert, no ALB (we are on HTTP API + CloudFront + S3, not ALB).
- **Consequences (bad):**
  - The MVP URL looks unprofessional (`d111111abcdef8.cloudfront.net` is not brandable). Acceptable for a technical-test MVP; not acceptable for production.
  - `us-east-1` is the most popular region for outages. The MVP has no multi-region failover; an `us-east-1` AZ failure means downtime.
  - Data residency: a future Colombian-customer requirement would force a move. Mitigated by keeping all infra in CDK (no manual console state).
- **Mitigations for the bad:**
  - The CloudFront distribution's `comment` field carries a TODO referencing the v2 follow-up "attach custom domain + ACM cert".
  - CDK synthesizes the same stacks to any region; the `region` constant lives in `packages/infra/src/config.ts` and is one line to change.
  - Multi-region failover is documented as a v2 follow-up alongside the custom-domain work.
  - One `vitest` CDK-construct test asserts the distribution has `domainNames: []` and `certificate` is unset (regression guard against accidental custom-domain work slipping into the MVP PR).

### 15.2 API Gateway throttling + Lambda concurrency (Q-A6)

#### 15.2.1 The decision

- **API Gateway HTTP API throttling:** **burst = 100, steady rate = 50** (HTTP API defaults). Both are tunable through CDK env (`packages/infra/src/config.ts → apiThrottling`). 429 responses carry the `Retry-After` header.
- **Lambda reserved concurrency:**
  - **`dev` stage:** **reserved = 1** per Lambda. Predictable cold-start behaviour, cost cap on a free-tier account, and a clear ceiling for the §12 alarm.
  - **`prod` stage:** **default (unreserved)**. Cost-optimization: account-level concurrency pool is shared; Lambdas scale up under load without us paying for idle reservation.
- **How to bump in CDK:** `packages/infra/src/stacks/ApiStack.ts` exposes `reservedConcurrencyByStage: Record<Stage, number>` (1 for `dev`, undefined for `prod`). Changing the prod value is a one-line edit; changing dev requires also updating the alarm threshold (see §15.3).

  #### 15.2.3 API Gateway HTTP API CORS (RISK-002)

    The SPA is served from `https://${distribution.distributionDomainName}` (CloudFront default URL per §15.1.1) and the API is at `https://<api-id>.execute-api.us-east-1.amazonaws.com` — different origins. Every request carries `Authorization` + `X-Request-Id` (+ optional `Idempotency-Key` and `Content-Type`), which makes each request a non-simple CORS request that **must** be answered by an `OPTIONS` preflight before the browser will send the actual call. Without the configuration below, every API call from the deployed SPA is blocked by the browser and the auth token never reaches the backend.

    ```ts
    // packages/infra/src/stacks/ApiStack.ts — HttpApi corsPreflight block (RISK-002)
    this.httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        // CloudFront default URL pulled at synth time from the FrontendStack export.
        // For MVP this is the only allowed origin. v2 may widen to a custom domain.
        allowOrigins: [`https://${distribution.distributionDomainName}`],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Request-Id',
          'Idempotency-Key',
        ],
        // JWT lives in the Authorization header, not in a cookie — credentials=false is correct.
        allowCredentials: false,
        maxAge: Duration.hours(1),
      },
    });
    ```

    Rationale for each knob:

  - `allowOrigins` is scoped to the CloudFront distribution domain **synth-time captured** (not a wildcard and not `*`) so a hostile site cannot issue preflights on behalf of our users.
  - `allowMethods` covers every method the SPA uses; `OPTIONS` is required for the preflight itself.
  - `allowHeaders` is the closed set sent by `services/http.ts` (§7.6). New headers added by the SPA must extend this list in the same PR.
  - `allowCredentials: false` because the JWT is in `Authorization`, never in a cookie. Setting `allowCredentials: true` without `SameSite` cookie handling would be a security regression.
  - `maxAge: 1 hour` lets the browser cache the preflight result so the user does not pay an extra RTT per request.

#### 15.2.2 ADR-9 (Q-A6): Burst 100 / steady 50, reserved concurrency 1 in dev, default in prod

- **Status:** Accepted
- **Context:** We must pick (a) API Gateway HTTP API throttling limits and (b) Lambda reserved concurrency per stage. Throttling too low = a benign burst (e.g. an operator clicking through several pages at once) returns 429; too high = a runaway client can exhaust our free-tier RDS connections before alarms fire. Reserved concurrency too low = the account-wide pool throttles us under burst; too high = we pay for idle capacity and lose the cold-start / cost-cap benefits.
- **Decision:** HTTP API burst 100, steady 50 (defaults; tunable). Lambda reserved concurrency = 1 per Lambda in `dev`, default in `prod`. Both are encoded as stage-aware constants in `packages/infra/src/config.ts`.
- **Consequences (good):**
  - 100/50 are AWS defaults and are well-documented; a future operator can tune without re-deriving the rationale.
  - `Retry-After` is set by API Gateway on 429 — the SPA can back off without guessing.
  - **Dev reserved = 1** is the cleanest way to make the §12 `ConcurrentExecutions > 80%` alarm meaningful (the alarm fires the moment we have a single in-flight invocation beyond one, which is realistic for a single-operator dev environment). It also caps the blast radius of any accidental infinite loop in the Lambdas.
  - **Prod default** is the cheapest posture: no idle reservation, the Lambdas scale up under traffic and back down when idle. The §12 alarm still fires if account-level throttling kicks in.
  - The decision is encoded in one file; changing it is a one-line edit + a CDK diff.
- **Consequences (bad):**
  - Dev reserved = 1 means concurrent requests to the same Lambda queue. A second login attempt while one is in flight waits. For a single-operator dev environment this is a non-issue.
  - Prod default means we have no per-Lambda concurrency ceiling in prod — a runaway Lambda could consume the whole account pool. The §12 throttle alarm catches the symptom, not the cause.
  - API Gateway burst 100 is per-route, not per-client. A misbehaving SPA component that fires 100 requests at once could deny service to other routes. Acceptable for MVP; documented.
- **Mitigations for the bad:**
  - Dev single-concurrency is documented in the §12 alarm threshold comment ("80% of 1"); bumping dev requires updating both the constant and the comment.
  - The dev account has its own quota (≤ 10 concurrent Lambda executions by default in a new account); reserved = 1 is well within budget.
  - For prod, a follow-up ADR is captured in §16 (out of scope) to revisit per-Lambda reserved concurrency once we have real traffic patterns.
  - One `vitest` CDK-construct test asserts `dev` reserved = 1 and `prod` reserved is unset.

### 15.3 CloudWatch alarms (binding infra observability)

These extend §12.4 (backend alarms) to the infra knobs in §15.2.

| Alarm | Metric | Threshold | Period | Stage | Action |
| --- | --- | --- | --- | --- | --- |
| `ConcurrentExecutions > 80% of reservedConcurrency` | `ConcurrentExecutions` per Lambda | `> 0.8` (dev, where reserved = 1 → fires at ≥ 1 concurrent invocation beyond the first) | 5 min | `dev` only | SNS → email ops |
| `ApiGateway5xx` | API Gateway `5xx` count | `> 0` | 5 min | both | SNS → email ops |
| `ApiGatewayThrottle` | API Gateway `4xx` where `error.message = "Too Many Requests"` (or metric from access log filter) | `> 0` | 5 min | both | SNS → email ops |
| `RdsFreeableMemory` | RDS `FreeableMemory` | `< 100 MB` | 5 min | both | SNS → email ops (R-4 mitigation from proposal) |

The existing §12 backend alarms (LambdaErrors, Throttles, ConcurrentExecutions) remain. The dev-specific `80% of 1` alarm becomes a no-op in prod (where reserved concurrency is unset and the metric has no denominator) — it is only attached in the `dev` stage of the CDK construct.

### 15.4 Quick reference — knobs pinned by this section

| Knob | Value | Source | Tunable in |
| --- | --- | --- | --- |
| AWS region | `us-east-1` | Q-A5 | `packages/infra/src/config.ts → region` |
| CloudFront alternate domain names | none | Q-A5 | `packages/infra/src/stacks/FrontendStack.ts` |
| CloudFront certificate | default (`*.cloudfront.net`) | Q-A5 | same |
| Custom domain + ACM | deferred | §16 | n/a |
| API Gateway throttling burst | 100 | Q-A6 | `packages/infra/src/config.ts → apiThrottling.burst` |
| API Gateway throttling steady | 50 | Q-A6 | same |
| Lambda reserved concurrency (dev) | 1 | Q-A6 | `packages/infra/src/config.ts → reservedConcurrencyByStage.dev` |
| Lambda reserved concurrency (prod) | default (unset) | Q-A6 | same |
| CloudWatch log retention | 7 days | ADR-7 (backend) | `packages/infra/src/stacks/ApiStack.ts` |
| Alarms SNS topic | one per stage, email subscription | §12.4 + §15.3 | `packages/infra/src/stacks/ObservabilityStack.ts` |
| API Gateway CORS allowed origin | CloudFront distribution domain (synth-time captured) | RISK-002 | `packages/infra/src/stacks/ApiStack.ts` |
| API Gateway CORS allowed headers | Content-Type, Authorization, X-Request-Id, Idempotency-Key | RISK-002 | `packages/infra/src/stacks/ApiStack.ts` |
| API Gateway CORS allowed methods | GET, POST, PATCH, OPTIONS | RISK-002 | `packages/infra/src/stacks/ApiStack.ts` |
| API Gateway CORS allowCredentials | false (JWT in headers, not cookies) | RISK-002 | `packages/infra/src/stacks/ApiStack.ts` |
| API Gateway CORS preflight maxAge | 1 hour | RISK-002 | `packages/infra/src/stacks/ApiStack.ts` |

---

## 16. Out of scope (restated as implementation consequences)

These exclusions were listed in the proposal §9. They are restated here as **implementation consequences** — what the `sdd-apply` phase MUST NOT build, and what the `sdd-verify` phase MUST flag if found.

| Excluded | Implementation consequence (what MUST NOT happen) |
| --- | --- |
| **Multi-tenancy** | No `tenant_id` column on any table. No `WHERE tenant_id = $1` predicates. No row-level security policies in Postgres. One RDS, one schema, one set of users. |
| **RBAC beyond `admin`** | No `viewer`, `purchasing-agent`, `manager` roles. The `users.role` column accepts only `'admin'` (DB-asserted in `User.assertInvariants`). No per-route role guards in `router/index.ts`; one `requiresAuth` check covers everything. |
| **Real-time push** | No WebSocket, no SSE, no GraphQL subscriptions. The SPA polls lists (5 s default interval, configurable per page). No `@vueuse/core` `useEventSource` import. |
| **Mobile clients** | Responsive web only. No React Native, no Flutter, no Capacitor wrapper. No `capacitor.config.ts`. The CSS targets ≥ 360px width; below that is unsupported and the design accepts that. |
| **Payments** | No payment provider integration. No `PaymentPort`. No `payment_status` column on `purchase_orders`. |
| **Supplier portal** | No public-facing supplier route. No `Supplier` aggregate. No supplier-side login. The `Product.supplier` field is a free-text string managed by the admin. |
| **Password reset** | No `POST /auth/forgot-password`, no `POST /auth/reset-password`, no email-sending adapter. A forgotten password requires ops intervention (run the seed again with a new `ADMIN_PASSWORD`, or insert a bcrypt hash directly). |
| **Refresh tokens** | No `POST /auth/refresh`. The 24h JWT (D7 + ADR-3 dual-secret rotation) is the only auth artefact. Token expiry → user logs in again. |
| **i18n beyond Spanish UI** | One locale shipped: `es-CO`. `en.json` exists only as the `vue-i18n` fallback for missing keys during development. Code, comments, commit messages, PR titles, and OpenAPI descriptions are English. No other locale folder may be added without an explicit out-of-scope expansion. |
| **Prod-tag deploy** | `deploy-prod.yml` is scaffolded with an `if: false` guard and a manual-approval step (per proposal §9). It is not exercised in this change. The `prod` CDK stage is **not** synthesized in `deploy-dev.yml`. |
| **CloudWatch dashboards beyond alarms** | One log group per Lambda + three alarms per Lambda (§12.4) + the §15.3 alarms. No JSON dashboard definitions, no `aws cloudwatch put-dashboard` calls. |
| **AI features** | `EmbeddingPort` and `ChatPort` exist as interfaces in the stack lock (`config.yaml → stack.ai`) but no adapter is wired in this change. The `domain/` layer of every BC contains zero imports from `@aws-sdk/*`, `openai`, `groq-sdk`, or any provider SDK. A Vitest + `eslint-plugin-boundaries` guard rejects any `import` statement under `packages/backend/src/<bc>/domain/` whose source matches `*provider*` or `*sdk*`. |
| **Dark mode** | Token system is structured to allow it (one `[data-theme='dark']` override block would do it), but no dark theme is shipped. No `data-theme` attribute is set anywhere. The `prefers-color-scheme` media query is not used in `tokens.css`. |
| **Multi-line orders, partial receipts** | One product per order. One receive call per order. No `OrderLine` table. |
| **Audit log beyond state-machine fields** | `PurchaseOrder` carries `createdAt`, `updatedAt`, `createdBy`. No separate `audit_log` table. No "who approved this, when" trail beyond the state itself. |
| **Cursor-based pagination** | Page + size only (`shared/spec.md §137–141`). No `cursor` query param. The `Page<T>` envelope is the single pagination contract. |

Anything not listed in §16 **and** not listed in the in-scope table at proposal §2.1 is, by definition, not part of this change. New work is a new change folder.

<!-- END-FRONTEND-DESIGN -->
````

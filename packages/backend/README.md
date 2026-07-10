# Backend — AWS Lambda Handlers

## Stack

- **Runtime:** AWS Lambda (Node.js 20)
- **Framework:** Raw Lambda handler (no Express/Fastify/NestJS)
- **ORM:** Prisma 5 with PostgreSQL 16 + pgvector
- **Auth:** JWT via `jose` (HS256, dual-secret rotation), bcrypt (cost 10)
- **Logging:** `pino` with mandatory fields (requestId, userId, bc, route, latencyMs, outcome)
- **Testing:** Vitest with testcontainers-postgres for integration tests

## Layout

```
src/
├── shared/              # Shared infrastructure: prisma client, logger, JWT middleware, error mapper
├── auth/                # Auth bounded context
│   ├── domain/         # User aggregate + value objects
│   ├── application/    # Login use case
│   ├── infrastructure/ # Postgres adapters (rate limiter, user repo, bcrypt, jose)
│   └── interface/      # Lambda handler + request/response schemas
├── products/           # Products bounded context (includes categories)
├── inventory/          # Inventory bounded context
├── alerts/             # Alerts bounded context
└── orders/             # Orders bounded context
```

## Domain Layer Rules

- `domain/` NEVER imports from any other layer
- Cross-cutting code lives in `packages/shared/`
- `application/` depends only on `domain/` and port interfaces
- `infrastructure/` implements port interfaces
- `interface/` connects Lambda to application services

## Scripts

```bash
pnpm --filter backend test              # Run tests
pnpm --filter backend test:watch       # Watch mode
pnpm --filter backend db:migrate       # Run Prisma migrations
pnpm --filter backend db:seed          # Seed database (admin user + categories)
pnpm --filter backend type-check       # tsc --noEmit
```

## Environment Variables

| Variable              | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string (from Secrets Manager in prod) |
| `JWT_SECRET`          | Current JWT signing secret (SSM SecureString)               |
| `JWT_SECRET_PREVIOUS` | Previous secret for rotation overlap (SSM SecureString)     |
| `JWT_OVERLAP_SECONDS` | Overlap window in seconds (default: 300)                    |
| `TRUSTED_PROXY_DEPTH` | Number of trusted proxies for X-Forwarded-For (default: 0)  |
| `ADMIN_USERNAME`      | Admin username (seed only)                                  |
| `ADMIN_EMAIL`         | Admin email (seed only)                                     |
| `ADMIN_PASSWORD`      | Admin password (seed only, SSM SecureString)                |

## Key Architecture Decisions

### Rate Limiting (RISK-003)

Login attempts are rate-limited per (IP, username) pair:

- 5 failures in 15 minutes → 429 response
- Counter persists in PostgreSQL (not in-memory)
- Counter resets after 15-minute window

### Dual-Secret JWT Rotation (ADR-3)

- Both `JWT_SECRET` and `JWT_SECRET_PREVIOUS` are tried
- During overlap window, either secret is valid
- After overlap, only new secret is valid

### Pessimistic Locking (RISK-002)

Inventory mutations use `SELECT ... FOR UPDATE` to serialize concurrent writes.

## Testing

Integration tests use testcontainers-postgres for ephemeral database:

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgres';
```

Unit tests mock infrastructure ports:

```typescript
const mockRateLimiter = { ... } satisfies RateLimiterPort;
```

## Deployment

Backend is deployed via CDK in `packages/infra/`. Each bounded context maps to one Lambda:

- `auth-lambda` → `/api/v1/auth/*`
- `products-lambda` → `/api/v1/products/*`, `/api/v1/categories/*`
- `inventory-lambda` → `/api/v1/products/{id}/movements`
- `alerts-lambda` → `/api/v1/alerts/*`
- `orders-lambda` → `/api/v1/orders/*`

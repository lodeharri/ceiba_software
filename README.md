# MercadoExpress

Inventory system for a Colombian retail chain. REST API + Vue 3 SPA + automated migrations.

## Quick links

- [Local development](#local-development) — 5 min to running
- [AWS deployment](#aws-deployment) — one-command deploy
- [API reference](#backend-api-reference) — URLs + test payloads
- [Architecture decisions](#architecture) — why the system is designed this way
- [Runbooks](#runbooks)
- [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) — detailed local setup

---

## Local development

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Node.js 20.x via nvm or asdf
- pnpm 9.x (`corepack enable pnpm` or `npm i -g pnpm`)
- Quick start: `pnpm install && pnpm setup && pnpm dev:api` + `pnpm dev:web`
- See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for detailed first-run guide

### Easiest path (5 minutes to running)

```bash
# 1. Clone + install
git clone <repo-url> ceiba_software
cd ceiba_software
pnpm install

# 1b. Build workspace packages (one-time, or after pulling changes)
#    @mercadoexpress/shared must be compiled so Lambda handlers can import from dist/
pnpm build

# 2. Copy env file (defaults work; edit JWT_SECRET for real dev)
cp .env.dev.example .env.dev

# 3. One-shot setup: start postgres + run migrations + seed
pnpm setup
# Runs: docker compose up -d (postgres only) + drizzle-kit migrate + idempotent seed

# 4. Start dev API + Vite frontend in separate terminals
pnpm dev       # runs: pnpm dev:api + pnpm dev:web (use separate terminals instead)
pnpm dev:api   # terminal 1 → http://localhost:3001
pnpm dev:web   # terminal 2 → http://localhost:5173
```

After startup:

| Service               | URL                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPA (Vite dev server) | <http://localhost:5173>                                                                                                                           |
| API (dev server)      | <http://localhost:3001/api/v1>                                                                                                                    |
| API health check      | `curl http://localhost:3001/api/v1/health`                                                                                                        |
| Login                 | `curl -X POST http://localhost:3001/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<your-password>"}'` |

**Default admin credentials (dev only):**

- Username: `admin`
- Password: see `ADMIN_PASSWORD` in your local `.env.dev` (defaults to a documented dev value; rotate before any real use)

**E2E test credentials:** the Playwright setup file (`e2e/setup.ts`) loads `.env.dev`
before any test runs. The alert E2E spec authenticates using `process.env.ADMIN_PASSWORD`
from `.env.dev`. To override, set `ADMIN_PASSWORD` in your shell before running
`pnpm test:e2e`.

### Troubleshooting

- **Port 3001 conflicts**: another `dev:api` process running. Kill with `pkill -f dev-server` or set `DEV_SERVER_PORT` in `.env.dev`.
- **Port 8080 conflicts**: set `FRONTEND_PORT` in `.env.dev`.
- **Port 5432 conflicts**: set `POSTGRES_PORT` in `.env.dev`.
- **`pnpm setup` fails**: run `pnpm db:migrate` separately + check `docker compose -f docker-compose.dev.yml logs postgres`.
- **`pnpm dev` fails with `DATABASE_URL not set`**: edit `.env.dev` and set `JWT_SECRET`.
- **Browser stale CORS**: run `pnpm dev:rebuild` to re-bake the frontend bundle, then hard-refresh.
- **Full reset**: `pnpm dev:reset && pnpm db:migrate && pnpm db:seed`.

See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for detailed troubleshooting.

---

## AWS deployment

### Prerequisites (one time)

```bash
aws configure --profile harrison-cicd
# Uses IAM user arn:aws:iam::216890067629:user/harrison-cicd-deploy
```

Bootstrap CDK (first time only):

```bash
cd packages/infra && pnpm exec cdk bootstrap aws://216890067629/us-east-1
```

### Deploy

```bash
# Deploy dev
cd packages/infra && pnpm deploy:dev

# Deploy prod
cd packages/infra && pnpm deploy:prod
```

### What gets deployed

- **4 CloudFormation stacks** with `-MercadoExpress-dev` prefix (e.g., `MercadoExpress-dev-Database`)
- **1 RDS Postgres** t3.micro + pgvector extension
- **2 VPC Interface Endpoints** (Secrets Manager + SSM, ~$14.60/mo)
- **1 S3 Gateway Endpoint** (free)
- **1 Lambda function**: `MercadoExpress-dev-api` (internal router dispatches to BC handlers)
- **1 HTTP API v2** (API Gateway)
- **1 S3 bucket** + **1 CloudFront distribution**

Migrations run via `.github/workflows/migrate.yml` (GitHub Actions, not CDK Custom Resource) before each deploy.

### Smoke-test after deploy

```bash
# Replace <api-id> with your deployment's API ID
URL="https://<api-id>.execute-api.us-east-1.amazonaws.com"
curl -X POST "$URL/api/v1/auth/login" -H "Content-Type: application/json" -d '{}'
# Expect: HTTP 400 VALIDATION_ERROR
```

### Get deployment URLs

```bash
# API Gateway base URL
aws cloudformation describe-stacks \
  --stack-name MercadoExpress-dev-Api-20260712 \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
  --output text --profile harrison-cicd

# CloudFront distribution
aws cloudformation describe-stacks \
  --stack-name MercadoExpress-dev-Frontend-20260712 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" \
  --output text --profile harrison-cicd
```

---

## Architecture

### Why a single Lambda with internal routing (not 5 separate Lambdas)?

A single `MercadoExpress-dev-api` Lambda uses an internal router that dispatches to bounded-context handlers. This keeps deployment simple (one artifact, one cold start) while preserving clean code boundaries — each BC handler is independently testable. Future work could split BCs into separate Lambdas if scale demands it.

### Why HTTP API v2 (not REST API)?

~70% cheaper ($1/million invocations vs $3.50/million). Native JWT authorizer support and simpler CORS handling out of the box.

### Why bearer JWT (not cookies)?

The API serves a cross-origin SPA and server-to-server clients. Bearer tokens don't require CSRF protection since the browser doesn't auto-send `Authorization` headers. JWT secret rotation is handled via dual-secret verification (`JWT_SECRET` + `JWT_SECRET_PREVIOUS`).

### Why Secrets Manager (not SSM Parameter Store)?

KMS-backed encryption at rest (SSM String param was plaintext). Auto-rotation support. Consistent with RDS-managed credentials already stored there.

### Why VPC Interface Endpoints (not NAT Gateway)?

$14.60/mo vs ~$32/mo. Lambdas only need Secrets Manager + SSM; no general internet egress. No NAT availability concerns.

### Why CDK (not Terraform)?

TypeScript = same language as Lambdas (shared types possible). Stack constructs are reusable and testable. Cross-stack references are first-class in CDK.

### Why pnpm (not npm/yarn)?

Workspace monorepo with shared dependencies. Strict peer dependency resolution. Disk-efficient content-addressable store. `--frozen-lockfile` in CI ensures reproducibility.

### Why Drizzle (not raw SQL or Prisma)?

Pure TypeScript schema with no native binary. Tiny client bundle (~50 KB vs Prisma's ~16 MB) that bundles cleanly into Lambda or Fargate without esbuild tricks, custom Lambda Layers, or `binaryTargets` configuration. SQL templates are first-class so `db.transaction` works for cross-BC atomic operations. Migrations run via `drizzle-kit migrate` invoked from a GitHub Actions workflow, not a CDK CustomResource.

### Why pgvector?

Future-proofing for semantic search on product descriptions. Same Postgres instance, no extra infrastructure.

### Why Vue 3 + Pinia + Tailwind (not React/Angular)?

Vue 3 Composition API with `<script setup lang="ts">` gives the best TypeScript DX. Pinia is the official Vue state library (replaces Vuex). Tailwind utility-first avoids design system overhead for an MVP.

### Why Vite (not webpack)?

~10x faster dev server (ESM-native). First-class TypeScript support.

### Why pnpm-lock.yaml + caret ranges?

The lockfile pins exact versions. Caret ranges allow patch/minor updates within CI's `pnpm install --frozen-lockfile`.

### Architecture diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CloudFront (d3deds6izr5yyd.cloudfront.net)                 │
│  - SPA static hosting (S3 backend)                          │
│  - /api/* behavior → origin: API Gateway                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴──────────┐
              ▼ /api/*               ▼ / (static)
┌──────────────────────────┐  ┌─────────────────────────────┐
│  API Gateway HTTP v2      │  │  S3: SPA bundle             │
│  Routes → 1 Lambda       │  │  index.html + assets        │
└──────────────────────────┘  └─────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  1 NodejsFunction Lambda (PRIVATE_ISOLATED subnets)          │
│  MercadoExpress-dev-api                                     │
│  Internal router dispatches to BC handlers:                 │
│    auth/ products/ inventory/ alerts/ orders/                │
│  DATABASE_URL resolved via Secrets Manager at synth time    │
└─────────────────────────┬───────────────────────────────────┘
                          │ (VPC Interface Endpoints)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  RDS Postgres 16 + pgvector (t3.micro)                      │
│  Secrets Manager: JWT_SECRET + JWT_PREVIOUS + ADMIN_PWD     │
│  CloudWatch Logs: 7-day retention per Lambda                │
│  CloudWatch Alarms: concurrent executions, errors, throttles │
│  SNS Topic: alarm notifications                              │
│  TODO: RDS Proxy for production (Lambda → RDS Proxy → RDS)  │
└─────────────────────────────────────────────────────────────┘
```

**Migrations**: run via `.github/workflows/migrate.yml` (GitHub Actions) before each deploy, not as a CDK Custom Resource.

---

## Technology stack

| Layer             | Tech                  | Version    | Why                                        |
| ----------------- | --------------------- | ---------- | ------------------------------------------ |
| Runtime           | Node.js               | 20.x       | Lambda runtime, same as local Node         |
| Language          | TypeScript            | 5.x strict | Type safety + superior tooling             |
| Monorepo          | pnpm workspaces       | 9.x        | Disk-efficient, strict peer deps           |
| Backend           | AWS Lambda            | Node 20.x  | Pay per invocation, no servers             |
| Backend framework | None (raw handlers)   | —          | No Express/Fastify overhead                |
| Validation        | Zod                   | 3.x        | Runtime type-safe parsing                  |
| Auth              | bcryptjs + jose       | latest     | Pure-JS bcrypt, modern JWT                 |
| DB                | RDS Postgres          | 16         | Managed, pgvector support                  |
| DB extension      | pgvector              | latest     | Semantic search on products                |
| ORM               | Drizzle               | 0.45.2     | Pure TypeScript schema, no native binary   |
| API Gateway       | HTTP API v2           | —          | ~70% cheaper than REST API                 |
| Frontend          | Vue                   | 3.5        | Composition API + script setup             |
| Frontend lang     | TypeScript            | 5.x        | Type safety end-to-end                     |
| Frontend build    | Vite                  | 5.x        | Fast ESM-based dev server                  |
| State mgmt        | Pinia                 | 2.x        | Official Vue state library                 |
| Router            | Vue Router            | 4.x        | Standard for Vue 3                         |
| Styling           | TailwindCSS           | 3.x        | Utility-first, no design system overhead   |
| i18n              | vue-i18n              | 9.x        | Spanish UI per spec                        |
| HTTP client       | ofetch                | latest     | Built-in retry/timeout, smaller than axios |
| Infra             | AWS CDK               | 2.155+     | TypeScript IaC                             |
| CI/CD             | GitHub Actions + OIDC | —          | No static AWS keys                         |
| Monitoring        | CloudWatch + SNS      | —          | Native AWS, no third party                 |

---

## Backend API reference

Base URL: `http://localhost:3001/api/v1` (local) or `https://<api-id>.execute-api.us-east-1.amazonaws.com` (AWS).

All authenticated endpoints require `Authorization: Bearer <JWT>` header.

Error envelope on 4xx/5xx:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable description",
  "details": [{ "field": "fieldName", "message": "why" }]
}
```

---

### `POST /api/v1/auth/login`

Issues a JWT token for an admin user.

**Auth**: not required

**Body**:

```json
{
  "username": "admin",
  "password": "..."
}
```

**Response 200**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2024-01-02T00:00:00.000Z",
  "user": { "id": "uuid", "username": "admin", "role": "admin" }
}
```

**Response 401**: `INVALID_CREDENTIALS` — wrong username or password
**Response 429**: `RATE_LIMITED` — too many login attempts from this IP

**cURL**:

```bash
curl -X POST "http://localhost:3001/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your-password>"}'
```

---

### `GET /api/v1/products`

List products with optional filters.

**Auth**: required

**Query params**:

| Param            | Type    | Description                        |
| ---------------- | ------- | ---------------------------------- |
| `categoryId`     | uuid    | Filter by category                 |
| `supplier`       | string  | Filter by supplier (partial match) |
| `hasActiveAlert` | boolean | Filter products with ACTIVA alert  |
| `minStock`       | number  | Minimum stock (inclusive)          |
| `maxStock`       | number  | Maximum stock (inclusive)          |
| `page`           | number  | Page number (default 1)            |
| `size`           | number  | Page size (default 20, max 100)    |

**Response 200**:

```json
{
  "items": [
    {
      "id": "uuid",
      "sku": "BEB-001",
      "name": "Agua Mineral 500ml",
      "categoryId": "uuid",
      "price": 1500,
      "stock": 150,
      "stockMin": 50,
      "supplier": "Distribuidora Andina",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "size": 20,
  "total": 6,
  "hasMore": false
}
```

**cURL**:

```bash
curl "http://localhost:3001/api/v1/products?page=1&size=20" \
  -H "Authorization: Bearer <JWT>"
```

---

### `POST /api/v1/products`

Create a new product.

**Auth**: required

**Body**:

```json
{
  "name": "Laptop Dell XPS 13",
  "sku": "DELL-XPS-13-001",
  "price": 3500000,
  "stock": 0,
  "stockMin": 5,
  "categoryId": "<category-uuid>",
  "supplier": "Dell Inc."
}
```

**Response 201**: Returns the created product object.

**Response 409**: `DUPLICATE_SKU` — SKU already exists

**cURL**:

```bash
curl -X POST "http://localhost:3001/api/v1/products" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Laptop Dell XPS 13",
    "sku": "DELL-XPS-13-001",
    "price": 3500000,
    "stock": 0,
    "stockMin": 5,
    "categoryId": "<uuid>",
    "supplier": "Dell Inc."
  }'
```

---

### `GET /api/v1/products/{id}`

Get a single product by ID.

**Auth**: required

**Response 200**: Product object (same shape as list item).
**Response 404**: `NOT_FOUND`

---

### `PATCH /api/v1/products/{id}`

Update product fields.

**Auth**: required

**Body** (all fields optional):

```json
{
  "name": "...",
  "price": 3600000,
  "stockMin": 10,
  "supplier": "..."
}
```

**Response 200**: Updated product object.
**Response 404**: `NOT_FOUND`

---

### `GET /api/v1/categories`

List all categories.

**Auth**: required

**Response 200**:

```json
[
  { "id": "uuid", "name": "Bebidas", "createdAt": "2024-01-01T00:00:00.000Z" },
  { "id": "uuid", "name": "Lacteos", "createdAt": "2024-01-01T00:00:00.000Z" }
]
```

**cURL**:

```bash
curl "http://localhost:3001/api/v1/categories" \
  -H "Authorization: Bearer <JWT>"
```

---

### `POST /api/v1/categories`

Create a category.

**Auth**: required

**Body**:

```json
{ "name": "Electronicos", "description": "Dispositivos electronicos" }
```

**Response 201**: Created category object.
**Response 409**: `DUPLICATE_NAME` — category name already exists.

---

### `GET /api/v1/products/{id}/movements`

List stock movements for a product (append-only ledger).

**Auth**: required

**Response 200**:

```json
[
  {
    "id": "uuid",
    "productId": "uuid",
    "type": "ENTRADA",
    "quantity": 100,
    "reason": "Initial inventory",
    "stockAfter": 100,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### `POST /api/v1/products/{id}/movements`

Record a stock movement (ENTRADA or SALIDA).

**Auth**: required

**Body**:

```json
{
  "type": "ENTRADA",
  "quantity": 50,
  "reason": "Restock from supplier"
}
```

**Response 201**:

```json
{
  "stockMovement": { "id": "uuid", "type": "ENTRADA", "quantity": 50, "stockAfter": 150 },
  "newStock": 150
}
```

**Business rules enforced**:

- `SALIDA` cannot leave stock negative — returns 400 `INSUFFICIENT_STOCK` with current stock in `details`.
- If stock drops to or below `stockMin` after a SALIDA, an alert of type `STOCK_BAJO` is automatically created (BR-3).
- If stock rises above `stockMin` after an ENTRADA and an ACTIVA alert exists, it is automatically resolved (BR-3).

**cURL**:

```bash
curl -X POST "http://localhost:3001/api/v1/products/<product-id>/movements" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"type":"ENTRADA","quantity":50,"reason":"Restock"}'
```

---

### `GET /api/v1/alerts`

List alerts, optionally filtered by status.

**Auth**: required

**Query params**:

| Param    | Type                   | Description                     |
| -------- | ---------------------- | ------------------------------- |
| `status` | `ACTIVA` \| `RESUELTA` | Filter by status (default: all) |

**Response 200**:

```json
[
  {
    "id": "uuid",
    "productId": "uuid",
    "type": "STOCK_BAJO",
    "status": "ACTIVA",
    "resolvedAt": null,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**cURL**:

```bash
curl "http://localhost:3001/api/v1/alerts?status=ACTIVA" \
  -H "Authorization: Bearer <JWT>"
```

---

### `GET /api/v1/alerts/{id}`

Get a single alert by ID.

**Auth**: required

**Response 200**: Alert object.
**Response 404**: `NOT_FOUND`

---

### `GET /api/v1/orders`

List purchase orders.

**Auth**: required

**Response 200**:

```json
[
  {
    "id": "uuid",
    "productId": "uuid",
    "quantity": 100,
    "status": "PENDIENTE",
    "supplierSnapshot": "Distribuidora Andina",
    "fromAlertId": "uuid",
    "reason": null,
    "createdBy": "uuid",
    "receivedAt": null,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### `GET /api/v1/orders/{id}`

Get a single order by ID.

**Auth**: required

**Response 200**: Order object.
**Response 404**: `NOT_FOUND`

---

### `POST /api/v1/orders`

Create a purchase order.

**Auth**: required

**Body**:

```json
{
  "productId": "<product-uuid>",
  "quantity": 100,
  "fromAlertId": "<alert-uuid>" // optional
}
```

**Business rules** (BR-2): `quantity` must be at least `2 * stockMin` of the product.

**Response 201**: Created order object (status `PENDIENTE`).
**Response 400**: `ORDER_QUANTITY_TOO_LOW` — quantity below 2x stockMin

**cURL**:

```bash
curl -X POST "http://localhost:3001/api/v1/orders" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"productId":"<product-uuid>","quantity":100}'
```

---

### `POST /api/v1/orders/{id}/approve`

Approve a PENDIENTE order.

**Auth**: required

**Response 200**: Order with status `APROBADA`.
**Response 409**: `INVALID_ORDER_STATUS` — order is not PENDIENTE (BR-5)

---

### `POST /api/v1/orders/{id}/reject`

Reject a PENDIENTE order.

**Auth**: required

**Body**:

```json
{ "reason": "Supplier out of stock for the quarter" }
```

**Response 200**: Order with status `RECHAZADA`.
**Response 400**: `VALIDATION_ERROR` — `reason` must be at least 10 characters.
**Response 409**: `INVALID_ORDER_STATUS` — order is not PENDIENTE.

---

### `POST /api/v1/orders/{id}/receive`

Receive an APROBADA order. Triggers atomic stock update + alert resolution.

**Auth**: required

**Business logic**:

1. Creates a `SALIDA`-type stock movement for the order quantity (stock increases).
2. If the resulting stock is above the product's `stockMin` and an ACTIVA alert exists for that product, the alert is resolved automatically (BR-3).
3. Order status becomes `RECIBIDA`; `receivedAt` is set.

**Response 200**: Order with status `RECIBIDA`.
**Response 409**: `INVALID_ORDER_STATUS` — order is not APROBADA.

**cURL**:

```bash
curl -X POST "http://localhost:3001/api/v1/orders/<order-id>/receive" \
  -H "Authorization: Bearer <JWT>"
```

---

### Complete test workflows

#### Workflow 1: Create product → stock entry → alert

```bash
TOKEN=$(curl -s -X POST "http://localhost:3001/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your-password>"}' | jq -r .token)

# Get a category ID
CAT_ID=$(curl -s "http://localhost:3001/api/v1/categories" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')

# Create product with stock=0, stockMin=10 (will trigger alert)
PRODUCT_ID=$(curl -s -X POST "http://localhost:3001/api/v1/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Agua Mineral 1L\",
    \"sku\": \"AGUA-001\",
    \"price\": 2000,
    \"stock\": 0,
    \"stockMin\": 10,
    \"categoryId\": \"$CAT_ID\",
    \"supplier\": \"Distribuidora Andina\"
  }" | jq -r .id)

# Check alert was created automatically (stock=0 < stockMin=10)
curl -s "http://localhost:3001/api/v1/alerts?status=ACTIVA" \
  -H "Authorization: Bearer $TOKEN" | jq

# Add stock (ENTRADA raises stock above threshold, resolves alert)
curl -X POST "http://localhost:3001/api/v1/products/$PRODUCT_ID/movements" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"ENTRADA","quantity":50,"reason":"Initial restock"}' | jq
```

#### Workflow 2: Create order from alert → approve → receive (atomic stock update)

```bash
# Assume a product with ACTIVA alert exists (from Workflow 1 or setup data)
TOKEN=$(curl -s -X POST "http://localhost:3001/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your-password>"}' | jq -r .token)

# Get ACTIVA alert
ALERT=$(curl -s "http://localhost:3001/api/v1/alerts?status=ACTIVA" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[0]')
ALERT_ID=$(echo "$ALERT" | jq -r .id)
PRODUCT_ID=$(echo "$ALERT" | jq -r .productId)

# Get product to know stockMin for minimum order qty (must be >= 2 * stockMin)
PRODUCT=$(curl -s "http://localhost:3001/api/v1/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r .)
MIN_QTY=$(echo "$PRODUCT" | jq -r '.stockMin * 2')
echo "Min order qty: $MIN_QTY"

# Create order from alert
ORDER_ID=$(curl -s -X POST "http://localhost:3001/api/v1/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":$MIN_QTY,\"fromAlertId\":\"$ALERT_ID\"}" \
  | jq -r .id)

# Approve order
curl -X POST "http://localhost:3001/api/v1/orders/$ORDER_ID/approve" \
  -H "Authorization: Bearer $TOKEN" | jq -r .status
# Expect: "APROBADA"

# Receive order (triggers SALIDA stock movement + auto-resolves alert)
curl -X POST "http://localhost:3001/api/v1/orders/$ORDER_ID/receive" \
  -H "Authorization: Bearer $TOKEN" | jq

# Verify alert is now RESUELTA
curl -s "http://localhost:3001/api/v1/alerts/$ALERT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r .status
# Expect: "RESUELTA"
```

---

## Testing

```bash
# Run all tests across packages
pnpm -w vitest run

# Backend tests only
pnpm -w vitest run --project=@mercadoexpress/backend

# Frontend tests only
pnpm -w vitest run --project=@mercadoexpress/frontend

# Infra tests only
pnpm -w vitest run --project=@mercadoexpress/infra

# Type-check all packages
pnpm -r tsc --noEmit

# Lint
pnpm lint
```

Test counts (from last audit):

| Package   | Tests   |
| --------- | ------- |
| Backend   | 304     |
| Frontend  | 151     |
| Infra     | 65      |
| Scripts   | 43      |
| **Total** | **749** |

---

## Project structure

```
ceiba_software/
├── packages/
│   ├── backend/                 # Lambda handlers + Drizzle schema
│   │   └── src/
│   │       ├── db/
│   │       │   ├── schema.ts     # DB models (users, products, categories,
│   │       │   └── seed.ts       # admin user + 6 categories + 6 products (idempotent)
│   │       ├── auth/             # Auth bounded context
│   │       ├── products/         # Products + Categories BC (co-hosted)
│   │       ├── inventory/        # Inventory BC (stock movements)
│   │       ├── alerts/           # Alerts BC
│   │       ├── orders/           # Orders BC
│   │       ├── lambda/           # Consolidated Lambda entry (handler.ts)
│   │       └── shared/           # Cross-BC: db client, UnitOfWork port,
│   │                              # jwt-middleware, dispatcher
│   │   drizzle/                  # Generated SQL migrations (run by CI)
│   │   drizzle.config.ts
│   ├── frontend/                # Vue 3 SPA (Atomic Design)
│   ├── infra/                   # AWS CDK app (4 stacks)
│   │   └── src/
│   │       ├── stacks/
│   │       │   ├── DatabaseStack.ts
│   │       │   ├── ApiStack.ts   # 1 Lambda with internal BC router
│   │       │   ├── FrontendStack.ts
│   │       │   └── ObservabilityStack.ts
│   │       └── config.ts        # All infra knobs (region, throttling, etc.)
│   └── shared/                  # Zod schemas, domain primitives, error codes
├── docker-compose.dev.yml       # postgres only (single container)
├── docs/
│   ├── LOCAL-DEV.md              # Detailed local setup guide
│   └── adr/                     # Architecture Decision Records
├── scripts/
│   ├── dev-server.ts            # Local Lambda simulation (tsx --watch)
│   ├── setup.ts                 # Bootstrap: docker up + migrations + seed
│   └── db.ts                    # DB script wrapper (migrate + seed)
├── openspec/                    # SDD change history
├── porject.md                   # Product spec (RF-01..RF-06, business rules)
└── README.md                    # ← you are here
```

---

## Common operations

```bash
# Reset local database
pnpm dev:reset
pnpm db:migrate
pnpm db:seed

# Restart local infrastructure
pnpm dev:down && pnpm dev:up

# View container logs
docker logs ceiba-postgres -f

# Tail Lambda logs on AWS (after deploy)
AWS_PROFILE=harrison-cicd aws logs tail \
  /aws/lambda/MercadoExpress-dev-auth-lambda --follow

# Run CDK diff before deploy
cd packages/infra && pnpm exec cdk diff -c stage=dev

# Synthesize CloudFormation template (no deploy)
cd packages/infra && pnpm synth:dev
```

---

## Troubleshooting

- **"Cannot find module '@mercadoexpress/shared'"**: run `pnpm --filter @mercadoexpress/shared build` (handlers import compiled dist/).
- **"EADDRINUSE port 3001"**: another `dev:api` process running. Kill with `pkill -f dev-server` or set `DEV_SERVER_PORT` in `.env.dev`.
- **"relation does not exist" on first request**: run `pnpm db:migrate` to apply pending Drizzle migrations.
- **pgvector not available**: verify `docker/postgres-init/01-pgvector.sql` mounts correctly in `docker-compose.dev.yml`.
- **Lambda timeout on first deploy**: RDS creation takes 5–8 min. Check `aws rds describe-db-instances --profile harrison-cicd`.
- **Login returns 401**: re-run `pnpm --filter @mercadoexpress/backend db:seed` to ensure the admin user exists with the `ADMIN_PASSWORD` from your `.env.dev`. JWT secrets (HS256) sign tokens; they do NOT match the bcrypt password hash.

---

## Runbooks

- [`runbook/rotate-admin-password.md`](runbook/rotate-admin-password.md) — rotate admin password via Secrets Manager
- [`runbook/oidc-bootstrap.md`](runbook/oidc-bootstrap.md) — set up GitHub Actions OIDC (no static AWS keys)

---

## Contributing

- **TDD**: Strict TDD is ACTIVE. RED → GREEN → TRIANGULATE → REFACTOR for every bounded context.
- **Commits**: Conventional commits enforced by Husky + commitlint. One logical change per commit. No `Co-Authored-By` lines other than `Harri`.
- **Backend layering** (per BC): `domain/` → `application/` → `interface/` ← `infrastructure/`. The `domain/` layer NEVER imports from any other layer.
- **Frontend**: Atomic Design (`atoms` → `molecules` → `organisms` → `templates` → `pages`). UI labels in Spanish (`es-CO`); code and comments in English.
- **pnpm required** (not npm or yarn). Use `pnpm install --frozen-lockfile` in CI.

---

## License

Proprietary — internal use only.

# SDD Exploration: add-product-semantic-search

**Phase:** sdd-explore  
**Artifact store:** openspec  
**Project:** ceiba_software  
**Branch:** feat/product-semantic-search

---

## 1. Executive Summary

The codebase is a TypeScript strict monorepo (pnpm workspaces) with a single AWS Lambda that dispatches all bounded-context (BC) handlers via an internal router. The products BC follows hexagonal architecture with strict layer separation: `domain/ports/` (pure interfaces), `application/` (use cases), `infrastructure/` (Drizzle adapters), and `interface/` (Lambda handlers). pgvector is already provisioned in RDS and Docker Postgres; the `vector` extension is enabled via `docker/postgres-init/01-pgvector.sql` (local) and the `default_extensions` parameter group (RDS). There is **zero existing AI code** — no `EmbeddingPort`, no `ChatPort`, no Google AI SDK, no provider stubs. The locked "minimal changes" rule requires that provider selection (Gemini, OpenAI, Ollama) lives entirely in `.env` / `.env.example` and infrastructure, with the domain/application layers containing only the port interface and zero concrete imports. The implementation scope is backend-only (Phase 1), frontend is out of scope.

---

## 2. Current Codebase Mapping

### 2.1 Products BC File Tree

```
packages/backend/src/products/
├── domain/
│   ├── errors/
│   │   ├── category-not-found.ts
│   │   ├── product-not-found.ts
│   │   └── sku-already-exists.ts
│   ├── ports/
│   │   ├── alert-read-model-port.ts   ← cross-BC seam (alerts BC)
│   │   ├── category-repository.ts     ← read-only, FK validation
│   │   └── product-repository.ts     ← primary CRUD port
│   └── product.ts                    ← aggregate root entity
├── application/
│   ├── create-product.ts              ← CreateProductUseCase
│   ├── create-product.test.ts         ← RED/GREEN/TRIANGULATE
│   ├── update-product.ts              ← UpdateProductUseCase
│   ├── update-product.test.ts
│   ├── list-products.ts               ← ListProductsUseCase
│   ├── list-products.test.ts
│   ├── get-product.ts                 ← GetProductUseCase
│   └── get-product.test.ts
├── infrastructure/
│   ├── drizzle-product-repository.ts  ← implements ProductRepository
│   ├── drizzle-category-read-repository.ts
│   └── drizzle-alert-read-model.ts
├── interface/
│   └── handlers/
│       ├── create-product.ts          ← POST /api/v1/products handler
│       ├── list-products.ts           ← GET /api/v1/products handler
│       ├── get-product.ts             ← GET /api/v1/products/{id} handler
│       └── update-product.ts          ← PATCH /api/v1/products/{id} handler
└── bootstrap.ts                       ← DI composition root
```

**No barrel `index.ts` in `domain/ports/`** — ports are imported by full path (e.g., `../domain/ports/product-repository.js`).

### 2.2 Existing Ports (Sample Pattern)

#### `products/domain/ports/product-repository.ts`

```typescript
export interface ProductRepository {
  findById(id: string): Promise<ProductProps | null>;
  findBySku(sku: string): Promise<ProductProps | null>;
  create(props: ProductProps): Promise<ProductProps>;
  update(id: string, partial: Partial<...>): Promise<ProductProps>;
  list(opts: ListOptions): Promise<Page<ProductProps>>;
}
```

All ports follow this pattern: pure TypeScript interfaces, no implementation details, async-only API.

#### `products/domain/ports/category-repository.ts`

```typescript
export interface CategoryReadView {
  id: string;
  name: string;
}
export interface CategoryReadRepository {
  findById(id: string): Promise<CategoryReadView | null>;
  list(): Promise<CategoryReadView[]>;
}
```

#### `products/domain/ports/alert-read-model-port.ts`

```typescript
export interface AlertReadModelPort {
  findProductIdsWithActiveAlert(): Promise<readonly string[]>;
  hasActiveAlert(productId: string): Promise<boolean>;
}
```

### 2.3 Drizzle Schema Location

- **Source:** `packages/backend/src/db/schema.ts`
- **Migrations:** `packages/backend/drizzle/`
- **Drizzle config:** `packages/backend/drizzle.config.ts` (schema → `./src/db/schema.ts`, out → `./drizzle`)
- **Current migration:** `packages/backend/drizzle/0000_initial.sql` (journal entry: `0000_initial`, idx: 0)

#### Current `products` table schema

```sql
CREATE TABLE "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku" text NOT NULL,
  "name" text NOT NULL,
  "category_id" uuid NOT NULL,
  "price" numeric(12, 0) NOT NULL,
  "stock" integer DEFAULT 0 NOT NULL,
  "stock_min" integer NOT NULL,
  "supplier" text NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
```

**No `embedding` column exists.** The new column `embedding vector(768)` must be added via a new migration file (e.g., `0001_add_product_embedding.sql`).

### 2.4 Bootstrap / DI Pattern

**File:** `packages/backend/src/products/bootstrap.ts`

```typescript
export function bootstrapProducts(dbOverride?: Db): ProductsBootstrap {
  const g = globalThis as GlobalWithProducts;
  if (g.__mercadoExpressProducts) return g.__mercadoExpressProducts;
  const db = dbOverride ?? getDb();
  const productRepo = new DrizzleProductRepository(db);
  const categoryRead = new DrizzleCategoryReadRepository(db);
  const alertReadModel = new DrizzleAlertReadModel(db);
  const alertOpener = new DrizzleAlertOpenerPort(db);
  return {
    db,
    logger,
    createProduct,
    listProducts,
    getProduct,
    updateProduct,
    categoryReadRepository,
  };
}
```

**Singleton pattern:** `globalThis.__mercadoExpressProducts` ensures one cold-start instance per Lambda execution environment. `EmbeddingPort` singleton would follow the same pattern.

### 2.5 Error Pattern

**Base class:** `packages/backend/src/shared/errors/base-domain-error.ts`

```typescript
export abstract class BaseDomainError extends Error {
  constructor(options: {
    code: ErrorCode;
    httpStatus: number;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  });
}
```

**Error codes:** `packages/shared/src/errors/errorCodes.ts` — canonical `ErrorCode` const object. A new code for embedding-related errors would need to be added here (e.g., `EMBEDDING_ERROR`, `NETWORK_ERROR` already exists, `TIMEOUT` already exists).

**Mapper:** `packages/backend/src/shared/error-mapper.ts` — `toErrorResponse()` handles all thrown values → API Gateway response.

### 2.6 .env / Secrets Locations

- **Cannot read `.env.example` or `.env.dev.example`** (sensitive file access blocked in this environment).
- Pattern confirmed from infrastructure code: Lambda receives secrets via:
  1. **AWS Secrets Manager** (primary): `{{resolve:secretsmanager:arn:SecretString:...}}` dynamic refs in Lambda environment variables at CDK deploy time
  2. **SSM Parameter Store** (deprecated legacy path): still referenced in `app.ts` for JWT secrets in non-AWS stages
  3. **Plain environment variables** (localstack): `DATABASE_URL` literal, `JWT_SECRET` literal
- For `GEMINI_API_KEY`: would follow the SSM Parameter Store pattern (`/MercadoExpress/{stage}/gemini-api-key`) or Secrets Manager pattern

---

## 3. Database (Drizzle + pgvector) Findings

### 3.1 Current Products Table

| Column      | Type            | Notes                         |
| ----------- | --------------- | ----------------------------- |
| id          | uuid            | PK, gen_random_uuid()         |
| sku         | text            | UNIQUE constraint             |
| name        | text            |                               |
| category_id | uuid            | FK → categories(id), restrict |
| price       | numeric(12, 0)  | D4 COP integer                |
| stock       | integer         | default 0                     |
| stock_min   | integer         |                               |
| supplier    | text            |                               |
| created_at  | timestamp(6) tz | default now()                 |
| updated_at  | timestamp(6) tz | default now()                 |

**No `embedding` column.** The new column must be added in a new migration.

### 3.2 Drizzle Schema File

**Location:** `packages/backend/src/db/schema.ts`  
Pattern for vector column (requires customType):

```typescript
import { customType } from 'drizzle-orm/pg-core';
const vector = customType<{ data: number[] }>({ dataType: () => 'vector(768)' });
// Usage: embedding: vector('embedding')
```

### 3.3 Migrations

- **Single existing migration:** `packages/backend/drizzle/0000_initial.sql` (journal: `"0000_initial"`)
- **Runner:** `.github/workflows/migrate.yml` — runs `pnpm --filter @mercadoexpress/backend db:migrate`
- **Pattern:** Drizzle Kit generates SQL; GitHub Actions applies via `drizzle-kit migrate` against the live DATABASE_URL from Secrets Manager
- **No `CREATE EXTENSION vector;`** in any existing migration — the extension is pre-enabled via:
  - **Local:** `docker/postgres-init/01-pgvector.sql` runs on first boot (CREATE EXTENSION IF NOT EXISTS vector)
  - **RDS:** `default_extensions` parameter group contains `vector`; additionally surfaced via CFN tag `ExtensionVector: pgvector`

### 3.4 pgvector Status

- **pgvector IS available** — enabled via Docker init script + RDS parameter group
- No `CREATE EXTENSION vector;` in existing migrations (safe to add in new migration)
- HNSW index pattern for semantic search (Drizzle supports it via `index().using('hnsw', ...)`)

---

## 4. Handler / Bootstrap / DI Findings

### 4.1 Lambda Entry Point

**File:** `packages/backend/src/lambda/handler.ts`

Single consolidated Lambda with internal router. Route map:

```typescript
const ROUTE_MAP: Record<string, SubHandler> = {
  'POST /api/v1/products': createProduct as SubHandler,
  'GET /api/v1/products': listProducts as SubHandler,
  'GET /api/v1/products/{id}': getProduct as SubHandler,
  'PATCH /api/v1/products/{id}': updateProduct as SubHandler,
  // ... other BCs
};
```

**New endpoint `POST /api/v1/products/semantic-search`** would require:

1. New handler file: `products/interface/handlers/semantic-search.ts`
2. Import + entry in `handler.ts` ROUTE_MAP
3. Route added to `packages/infra/src/stacks/ApiStack.ts` LAMBDAS constant
4. CDK deploy (for route provisioning)

### 4.2 Bootstrap / DI Singleton Pattern

**Confirmed:** `bootstrapProducts()` in `products/bootstrap.ts` creates one `ProductsBootstrap` instance per cold start via `globalThis`. All adapters (DB repos, alert ports, logger) are instantiated once and injected into use cases.

**Where embedding fits:** A singleton `EmbeddingPort` implementation (GeminiEmbeddingAdapter) would be:

1. Instantiated in `bootstrapProducts()` alongside `productRepo`, `categoryRead`, etc.
2. Passed to a new `SemanticSearchUseCase` and to `CreateProductUseCase` / `UpdateProductUseCase`
3. Wired via the same `globalThis.__mercadoExpressProducts` singleton pattern

### 4.3 JWT Middleware Pattern

JWT verification is **inside each handler** (not at the Lambda entry level):

```typescript
const token = extractBearer(event);
await verifyJwt(token);
```

New semantic-search handler would follow the same pattern.

---

## 5. Existing Create/Update Product Flow

### 5.1 CreateProductUseCase (`create-product.ts`)

```typescript
async execute(input: CreateProductInput): Promise<Product> {
  // 1. Aggregate creation (validates invariants)
  const aggregate = Product.create({ id: randomUUID(), ...input });

  // 2. FK validation
  const category = await this.categories.findById(aggregate.categoryId);
  if (!category) throw new CategoryNotFoundError(...);

  // 3. SKU uniqueness
  const existing = await this.products.findBySku(aggregate.sku);
  if (existing) throw new SkuAlreadyExistsError(...);

  // 4. Persist
  const persisted = await this.products.create({ ...props, createdAt: new Date(), updatedAt: new Date() });

  // 5. Best-effort alert creation (non-blocking)
  if (aggregate.stock <= aggregate.stockMin) {
    try { await this.alertOpener.openIfAbsent(aggregate.id); }
    catch (e) { console.error(...); }
  }

  return Product.rehydrate(persisted);
}
```

**Embedding insertion point:** After step 4 (persist) but before step 5 (alerts). The embedding should be computed from `name + " " + description + " " + supplier`. Design question: sync (adds latency to create) vs. async (eventual consistency).

### 5.2 UpdateProductUseCase (`update-product.ts`)

```typescript
async execute(id: string, input: UpdateProductInput): Promise<Product> {
  const existing = await this.products.findById(id);
  if (!existing) throw new ProductNotFoundError(id);
  if (input.categoryId) { const c = await this.categories.findById(...); ... }
  const updated = await this.products.update(id, input);
  const product = Product.rehydrate(updated);
  const hasActiveAlert = await this.alertReadModel.hasActiveAlert(id);
  return product.withAlertFlag(hasActiveAlert);
}
```

**Embedding update point:** When `name`, `supplier`, or any text field used in embedding changes → re-compute and update the `embedding` column.

---

## 6. AI Adapter Pattern Constraints

### 6.1 Zero Existing AI Code

Confirmed via grep across entire `packages/backend/`: **no** `EmbeddingPort`, `ChatPort`, `GeminiEmbedding`, `google-ai`, or any AI provider code exists.

### 6.2 Locked Decision: Stack-Decisions

From the locked preflight (`sdd/mercadoexpress/stack-decisions` in Engram): A future-ready plan mentions Ollama/Groq/OpenAI adapters. Google AI Studio (`gemini-embedding-001`) replaces/augments that plan.

### 6.3 Minimum-Viable Port Surface

```typescript
// products/domain/ports/embedding.ts
export interface EmbeddingPort {
  /** Embeds a single text string. Returns a 768-dimensional vector. */
  embed(text: string): Promise<number[]>;
  /** Optional batch embedding for efficiency. */
  embedBatch?(texts: string[]): Promise<number[][]>;
}
```

**Key constraints:**

- Domain layer imports ONLY the port interface (no concrete provider class)
- Infrastructure layer holds the concrete `GeminiEmbeddingAdapter`
- Factory pattern in `bootstrapProducts()` selects adapter based on `EMBEDDING_PROVIDER` env var
- Adding OpenAI/Ollama/anthropic = add new adapter in infrastructure + update factory + update `.env.example`

---

## 7. Tests Pattern

### 7.1 Unit Tests (Vitest + strict TDD)

**Domain tests** (`products/domain/product.test.ts`):

```typescript
describe('Product.create', () => {
  it('creates a valid product', () => { ... });
  it('rejects name shorter than 3 chars', () => { ... });
  // RED → GREEN → TRIANGULATE
});
```

**Application tests** (`products/application/create-product.test.ts`):

- Manual stub objects implementing port interfaces (`makeRepos()` pattern)
- No `vi.mock()` for port mocks — explicit stub objects passed to use case constructor
- Tests cover: happy path, error paths (SKU conflict, FK violation, alert opener failure)

**Handler tests** (`orders/interface/handlers/create-order.test.ts`):

- `vi.mock()` for JWT middleware and bootstrap
- Mock execute results directly
- `vi.fn()` assertions for call verification

### 7.2 Port Mocking Pattern

```typescript
const products: ProductRepository = {
  async findById(id) {
    return null;
  },
  async findBySku(sku) {
    return null;
  },
  async create(props) {
    created.push(props);
    return { ...props };
  },
  async update(id, partial) {
    throw new Error('not used');
  },
  async list() {
    return { items: [], page: 1, size: 20, total: 0, hasMore: false };
  },
};
```

**EmbeddingPort mocking in domain/application tests** would follow the same pattern: a manual stub object implementing `EmbeddingPort` passed via constructor injection.

### 7.3 pg-mem Setup

- **Present:** `pg-mem` listed in `packages/backend/package.json` devDependencies (`^3.0.0`)
- **Not yet used** in any existing test file (grep returned no results)
- Would be used for integration tests of the `SemanticSearchUseCase` against a real pgvector-backed in-memory DB

---

## 8. Open Questions for Proposal Phase

1. **Sync vs. async on create/update**: Should the embedding call block the create/update response (adds latency, transactional), or should it fire-and-forget (async, eventual consistency)? The `alertOpener` pattern uses best-effort async (`try/catch` + `console.error`), but embedding is a critical feature.

2. **Gemini API down at create time**: Fail-closed (rollback/reject the request) or fail-open (log + continue without embedding)? Option 2 means products exist without vectors until a re-embed job runs.

3. **Re-embed strategy for existing products**: A manual Lambda trigger (one-time) or a scheduled job? How to handle rate limits on the Gemini API for bulk re-embedding?

4. **API key rotation**: SSM Parameter Store `SECURE_STRING` for the Lambda? Dynamic refresh without Lambda restart? Or rebuild + redeploy?

5. **Dimension validation at startup**: Should the factory validate that `embeddingDimension` from env matches the model's actual dimension (768 for gemini-embedding-001)? Fail-fast vs. lazy validation.

6. **Rate limiting on `/products/semantic-search`**: The API Gateway has default throttle (100 burst / 50 steady). Should the semantic search endpoint have its own throttle limit?

7. **Frontend integration scope**: Phase 1 is backend-only, but is there a call-out for UI work in Phase 2? (Frontend devs need to know the endpoint contract.)

8. **pgvector index type**: HNSW (`using 'hnsw'` in Drizzle) vs. IVFFlat. HNSW is the modern default (better query performance, no training data needed). Confirm.

9. **Embedding column nullable?**: Should existing products without embedding be `NULL` or should they be back-filled? If nullable, semantic search should exclude `NULL` rows.

10. **What ErrorCode to use for embedding failures**: `NETWORK_ERROR` and `TIMEOUT` already exist in the shared `ErrorCode` enum. No new code needed unless a semantic-search-specific error is required.

---

## 9. Out of Scope

- **ChatPort / LLM port** — only `EmbeddingPort` is in scope
- **Multi-provider routing / A/B testing** — single provider per env, switchable via `.env`
- **Frontend UI** — Phase 1 is backend-only
- **Re-embed batch of existing products** — backlog, one-time manual trigger acceptable for Phase 1
- **Caching of embeddings** — pgvector stores them; no Redis or in-memory cache needed
- **Real-time vector updates** — product updates trigger re-embed, not streaming
- **Alternative embedding models** (OpenAI `text-embedding-3-small`, Ollama) — architecture supports them via factory, but Phase 1 implements only Gemini

---

## 10. Risks

1. **Lambda cold start impact (Gemini client init)** — Severity: MEDIUM. Each cold start initializes the Gemini HTTP client. Mitigation: `globalThis` singleton keeps the client warm between invocations; monitor cold start latency in CloudWatch.

2. **pgvector index size for ~thousands of products** — Severity: LOW. HNSW is memory-intensive but 768-dim × ~1000 products ≈ ~3 MB. No concern for MVP scale.

3. **Drizzle ORM support for `vector` type** — Severity: MEDIUM. Drizzle's `customType` can emit `vector(768)`, but `select()` returns raw arrays (not typed `number[]`). Need explicit cast in repository queries. Verified: `customType` pattern works with pgvector.

4. **.env drift between local and AWS SSM** — Severity: HIGH. `GEMINI_API_KEY` in `.env.dev.example` must match the SSM parameter name/pattern used in Lambda env. The locked constraint (minimal changes) means the factory + env mapping must be precise.

5. **API key leakage in logs (pino)** — Severity: MEDIUM. If the embedding adapter logs the API key or request body, it leaks to CloudWatch. Must audit all logging statements in the adapter before production.

6. **Idempotency: re-running migration on populated table** — Severity: MEDIUM. Adding a non-nullable `embedding` column to an existing `products` table with data fails. Migration must either: (a) add nullable column first, back-fill, then add not-null constraint, or (b) use a default expression (not possible for vector type). Safe pattern: nullable column + backfill in application layer.

7. **Gemini API rate limits** — Severity: MEDIUM. Google AI Studio has per-minute and per-day quotas. Bulk re-embedding (if implemented) could hit limits. Mitigation: batch with delays, exponential backoff, and per-request error handling.

---

## Files Read (25 total)

| #   | File                                                                         | Purpose                                 |
| --- | ---------------------------------------------------------------------------- | --------------------------------------- |
| 1   | `README.md`                                                                  | Project overview, stack, architecture   |
| 2   | `packages/backend/src/shared/db.ts`                                          | Drizzle singleton pattern               |
| 3   | `packages/backend/drizzle.config.ts`                                         | Drizzle config (schema, out, dialect)   |
| 4   | `packages/backend/src/db/schema.ts`                                          | Drizzle schema — all tables             |
| 5   | `packages/backend/drizzle/meta/_journal.json`                                | Migration journal                       |
| 6   | `packages/backend/drizzle/0000_initial.sql`                                  | Existing migration (products table)     |
| 7   | `packages/backend/src/products/application/create-product.ts`                | Create flow + embedding insertion point |
| 8   | `packages/backend/src/products/application/update-product.ts`                | Update flow + re-embed point            |
| 9   | `packages/backend/src/products/domain/ports/product-repository.ts`           | Port pattern sample                     |
| 10  | `packages/backend/src/products/domain/ports/category-repository.ts`          | Read-only port pattern                  |
| 11  | `packages/backend/src/products/domain/ports/alert-read-model-port.ts`        | Cross-BC port pattern                   |
| 12  | `packages/backend/src/products/bootstrap.ts`                                 | DI singleton composition root           |
| 13  | `packages/backend/src/shared/errors/base-domain-error.ts`                    | Error base class                        |
| 14  | `packages/backend/src/shared/error-mapper.ts`                                | Error-to-HTTP mapping                   |
| 15  | `packages/backend/src/lambda/handler.ts`                                     | Single Lambda route map                 |
| 16  | `packages/infra/src/stacks/ApiStack.ts`                                      | CDK route provisioning                  |
| 17  | `packages/infra/src/app.ts`                                                  | CDK stage + secret wiring               |
| 18  | `packages/infra/src/stacks/DatabaseStack.ts`                                 | RDS + pgvector + Secrets Manager        |
| 19  | `packages/infra/src/config.ts`                                               | Infra configuration knobs               |
| 20  | `packages/shared/src/errors/errorCodes.ts`                                   | Canonical error code registry           |
| 21  | `packages/backend/package.json`                                              | Dependencies (pg-mem, drizzle-orm)      |
| 22  | `packages/backend/src/products/infrastructure/drizzle-product-repository.ts` | Drizzle adapter pattern                 |
| 23  | `packages/backend/src/shared/logger.ts`                                      | Pino logger factory                     |
| 24  | `docker/postgres-init/01-pgvector.sql`                                       | Local pgvector init                     |
| 25  | `packages/backend/src/products/domain/product.test.ts`                       | TDD pattern sample                      |
| 26  | `packages/backend/src/products/application/create-product.test.ts`           | Use case test pattern                   |
| 27  | `packages/backend/test/architecture/cross-bc-bounds.test.ts`                 | Cross-BC boundary enforcement           |
| 28  | `.github/workflows/migrate.yml`                                              | Migration CI runner                     |
| 29  | `packages/backend/vitest.config.ts`                                          | Vitest configuration                    |

---

## Skill Resolution

- `paths-injected` — pi-lens SKILL.md files read; no additional skill matches found for this phase.

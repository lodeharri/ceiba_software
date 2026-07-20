# Design: add-product-semantic-search

## 1. Overview

This change adds meaning-based product search to the products BC. The `POST /api/v1/products/semantic-search` endpoint embeds a natural-language query using `gemini-embedding-001` (768 dims, Google AI Studio) and returns products ordered by cosine similarity via pgvector. Newly created or updated products receive their embedding asynchronously (fire-and-forget) with a fail-open retry policy (3 attempts, 1s/2s/4s). The domain and application layers contain zero concrete AI SDK imports — a hexagonal `EmbeddingPort` interface is the only seam. Provider switching is a single `EMBEDDING_PROVIDER` env var plus one adapter file.

---

## 2. Architecture

### 2.1 Component Layout (tree)

```
packages/backend/src/
├── db/
│   └── schema.ts                               [MODIFIED — add vector customType + embedding column]
├── drizzle/
│   └── 0001_add_product_embedding.sql          [NEW — idempotent HNSW migration]
├── products/
│   ├── domain/
│   │   ├── ports/
│   │   │   └── embedding.ts                    [NEW — EmbeddingPort interface]
│   │   └── errors/
│   │       ├── embedding-provider-unavailable.ts  [NEW]
│   │       ├── embedding-input-too-long.ts        [NEW]
│   │       └── invalid-semantic-search-query.ts  [NEW]
│   ├── application/
│   │   ├── create-product.ts                   [MODIFIED — inject EmbeddingPort, fire-and-forget embed]
│   │   ├── update-product.ts                  [MODIFIED — inject EmbeddingPort, detect text-field changes]
│   │   └── semantic-search-products.ts        [NEW — SemanticSearchUseCase]
│   ├── infrastructure/
│   │   ├── embedding/
│   │   │   ├── gemini-adapter.ts              [NEW — GeminiEmbeddingAdapter]
│   │   │   ├── factory.ts                     [NEW — EmbeddingFactory]
│   │   │   └── api-key-resolver.ts            [NEW — SSM + local env resolver]
│   │   └── drizzle-product-repository.ts      [MODIFIED — add findByEmbedding + updateEmbedding]
│   ├── interface/
│   │   └── handlers/
│   │       └── semantic-search-products.ts     [NEW — POST /api/v1/products/semantic-search handler]
│   └── bootstrap.ts                           [MODIFIED — wire EmbeddingPort into use cases]
├── lambda/
│   └── handler.ts                             [MODIFIED — add route to ROUTE_MAP]
└── shared/
    ├── error-mapper.ts                        [MODIFIED — add 3 new error cases]
    └── errors/
        └── base-domain-error.ts                [no change — used as-is]
packages/backend/test/architecture/
└── embedding-layer-discipline.test.ts          [NEW — zero SDK imports in domain/application]
packages/shared/src/errors/
└── errorCodes.ts                              [MODIFIED — add 3 new error codes]
.env.dev.example                               [MODIFIED — add embedding env vars]
.env.example                                   [MODIFIED — add embedding env vars]
packages/infra/src/stacks/
├── ApiStack.ts                                [MODIFIED — add route + IAM permission]
└── DatabaseStack.ts                           [MODIFIED — add SSM SecureString param]
```

### 2.2 Layer Wiring (DI)

```
SSM Parameter Store / .env.local
        │
        ▼
  GeminiApiKeyResolver  ──► API key string
        │
        ▼
  EmbeddingFactory.buildEmbeddingProvider({ provider, apiKey })
        │
        ├── provider = 'gemini' ──► new GeminiEmbeddingAdapter({ apiKey, httpClient, logger })
        │
        └── (singleton memoized per provider via module-level Map)
        │
        ▼
  EmbeddingPort (interface)
        │
        ├──► CreateProductUseCase  (optional, fire-and-forget)
        ├──► UpdateProductUseCase  (optional, fire-and-forget)
        └──► SemanticSearchUseCase (required, blocking)
```

### 2.3 Data Flow (sequences)

#### 2.3.1 Lambda cold start

```
bootstrapProducts()
  → resolveApiKey()                  [SSM or process.env.GEMINI_API_KEY]
  → EmbeddingFactory.buildEmbeddingProvider({ provider, apiKey })
  → new GeminiEmbeddingAdapter({ apiKey, httpClient, logger })
  → new CreateProductUseCase(productRepo, categoryRead, alertOpener, embeddingPort?)
  → new UpdateProductUseCase(productRepo, categoryRead, alertReadModel, embeddingPort?)
  → new SemanticSearchUseCase(embedder, productRepo)
  → cache in globalThis.__mercadoExpressProducts
  → return ProductsBootstrap
```

#### 2.3.2 Create product

```
POST /api/v1/products
  → CreateProductUseCase.execute(input)
      → Product.create(input)                    [aggregate validation]
      → categoryRepo.findById(categoryId)         [FK check]
      → productRepo.findBySku(sku)               [uniqueness check]
      → productRepo.create(props)                [persist product]
      → setImmediate(() => embedInBackground(product))
          → embedder.embed(text) with retry (1s/2s/4s)
              → SUCCESS: productRepo.updateEmbedding(id, vector)
              → FAIL after 3x: logger.warn(), embedding stays NULL
      → alertOpener.openIfAbsent(id)             [best-effort, existing pattern]
  → return Product (201)
```

#### 2.3.3 Update product (text field changed)

```
PATCH /api/v1/products/{id} with { name: "New Name" }
  → UpdateProductUseCase.execute(id, input)
      → productRepo.findById(id)                 [fetch existing]
      → productRepo.update(id, { name })         [persist]
      → setImmediate(() => embedInBackground(updatedProduct))
          → embedder.embed(text) with retry → updateEmbedding(id, vector)
  → return Product (200)
```

#### 2.3.4 Update product (stock only)

```
PATCH /api/v1/products/{id} with { stock: 200 }
  → UpdateProductUseCase.execute(id, input)
      → productRepo.findById(id)
      → productRepo.update(id, { stock })        [persist]
      → (NO setImmediate, NO embedInBackground)  [text fields not in input]
  → return Product (200)
```

#### 2.3.5 Semantic search

```
POST /api/v1/products/semantic-search { q: "laptop gaming", limit: 10 }
  → handler: validate JWT, parse Zod body
  → SemanticSearchUseCase.execute({ query: "laptop gaming", limit: 10 })
      → validate query.length ∈ [3, 1024]  → throw InvalidSemanticSearchQuery if not
      → embedder.embed("laptop gaming")    [blocking, with retry]
          → FAIL: throw EmbeddingProviderUnavailable
      → productRepo.findByEmbedding(vector, { limit: 10 })
          → SQL: WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 10
      → map to Product[] via Product.rehydrate()
  → return { items: Product[], total: number }  (200)
```

#### 2.3.6 Fail-open on Gemini outage

```
CreateProductUseCase.execute(input)
  → productRepo.create(props)              [product persisted, 201 returned to client]
  → embedInBackground(product)
      → Attempt 1 → HTTP 500 → log warn { provider: 'gemini', attempt: 1, latencyMs, outcome: 'retry' }
      → wait 1000ms
      → Attempt 2 → HTTP 500 → log warn { ... }
      → wait 2000ms
      → Attempt 3 → HTTP 500 → log warn { ... }
      → EXHAUSTED → log warn { provider: 'gemini', outcome: 'exhausted' }
      → (NO throw, NO updateEmbedding call)
  → product.embedding = NULL in DB
  → no error surfaced to HTTP response
```

---

## 3. Components and Contracts

### R1: EmbeddingPort

**File:** `packages/backend/src/products/domain/ports/embedding.ts`

```typescript
export interface EmbeddingPort {
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: string[]): Promise<readonly (readonly number[])[]>;
}
```

**Test strategy:** Manual stub objects implementing `EmbeddingPort` in all application-level tests. Stub returns `Array(768).fill(Math.random())`. No HTTP calls. Assert call arguments, return length, and async behavior.

---

### R2: GeminiEmbeddingAdapter

**File:** `packages/backend/src/products/infrastructure/embedding/gemini-adapter.ts`

```typescript
import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import { EmbeddingInputTooLongError } from '../../domain/errors/embedding-input-too-long.js';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import type { Logger as PinoLogger } from 'pino';

const GEMINI_EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const MAX_INPUT_CHARS = 8192;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface GeminiAdapterDeps {
  apiKey: string;
  httpClient?: typeof fetch;
  logger: PinoLogger;
}

export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly http: typeof fetch;
  private readonly log: PinoLogger;

  constructor(private readonly deps: GeminiAdapterDeps) {
    this.http = deps.httpClient ?? globalThis.fetch;
    this.log = deps.logger.child({ component: 'GeminiEmbeddingAdapter' });
  }

  async embed(text: string): Promise<readonly number[]> {
    if (text.length > MAX_INPUT_CHARS) {
      throw new EmbeddingInputTooLongError(text.length);
    }
    return this.withRetry(() => this.callGemini(text));
  }

  async embedBatch(texts: string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  private async callGemini(text: string): Promise<readonly number[]> {
    const url = `${GEMINI_EMBEDDING_URL}?key=${this.deps.apiKey}`;
    const body = JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    });
    const res = await this.http(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const reason = `HTTP ${res.status}`;
      this.log.warn({ provider: 'gemini', reason, statusCode: res.status });
      throw new EmbeddingProviderUnavailableError('gemini', reason);
    }
    const json = (await res.json()) as { embedding: { values: number[] } };
    this.log.info({ provider: 'gemini', statusCode: res.status, latencyMs: 0 }); // timing added by wrapper
    return json.embedding.values;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      const t0 = Date.now();
      try {
        const result = await fn();
        this.log.info({
          provider: 'gemini',
          attempt,
          latencyMs: Date.now() - t0,
          outcome: 'success',
        });
        return result;
      } catch (err) {
        lastError = err;
        const delay = RETRY_DELAYS_MS[attempt - 2]; // attempt 2→index0, attempt 3→index1
        this.log.warn({
          provider: 'gemini',
          attempt,
          latencyMs: Date.now() - t0,
          outcome: attempt <= RETRY_DELAYS_MS.length + 1 ? 'retry' : 'exhausted',
          reason: lastError instanceof Error ? lastError.message : String(lastError),
        });
        if (attempt > RETRY_DELAYS_MS.length) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }
}
```

**Notes:**

- `withRetry` is private; attempts run sequentially.
- `callGemini` does NOT catch non-ok HTTP responses — it propagates so `withRetry` can retry.
- Latency timing added in `withRetry` (caller context), not in `callGemini`.
- The `apiKey` parameter value **never appears in any log call** — pino redaction is configured in `createLogger` (see §3.4).

**Test strategy:** Inject a fake `httpClient` via constructor. Assert:

1. Success: returns parsed vector, log called with `outcome: 'success'`
2. Retry: `httpClient` returns 429 on first call, ok on second → exactly 2 calls, `outcome: 'retry'` logged once
3. Exhaust: `httpClient` returns 500 three times → exactly 3 calls, final throw is `EmbeddingProviderUnavailableError`
4. Input too long: string > 8192 chars → `EmbeddingInputTooLongError`, zero HTTP calls
5. API key never in logs: assert no log call contains the apiKey string (redaction tested at integration level)

---

### R3: EmbeddingFactory

**File:** `packages/backend/src/products/infrastructure/embedding/factory.ts`

```typescript
import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import { GeminiEmbeddingAdapter } from './gemini-adapter.js';
import type { Logger as PinoLogger } from 'pino';

const cache = new Map<string, EmbeddingPort>();

export interface BuildProviderSettings {
  provider: string;
  apiKey?: string;
  logger: PinoLogger;
  httpClient?: typeof fetch;
}

export function buildEmbeddingProvider(settings: BuildProviderSettings): EmbeddingPort {
  const { provider } = settings;
  if (cache.has(provider)) return cache.get(provider)!;

  switch (provider) {
    case 'gemini': {
      if (!settings.apiKey) {
        throw new EmbeddingProviderUnavailableError('gemini', 'missing-api-key');
      }
      const adapter = new GeminiEmbeddingAdapter({
        apiKey: settings.apiKey,
        httpClient: settings.httpClient,
        logger: settings.logger,
      });
      cache.set(provider, adapter);
      return adapter;
    }
    default:
      throw new EmbeddingProviderUnavailableError(provider, 'unknown-provider');
  }
}
```

**Singleton memoization:** `cache` is a module-level `Map<string, EmbeddingPort>`. The key is the provider name. Thread-safe enough for single-threaded JS. Exported `cache` reset is not needed for Phase 1.

**Test strategy:**

1. Call with `provider: 'gemini', apiKey: 'sk-test'` twice → assert same object reference returned
2. Call with `provider: 'unknown'` → assert `EmbeddingProviderUnavailableError` thrown at construction
3. Call with `provider: 'gemini'` (no apiKey) → assert `EmbeddingProviderUnavailableError` thrown with reason `'missing-api-key'`

---

### R4: SSM API Key Resolver

**File:** `packages/backend/src/products/infrastructure/embedding/api-key-resolver.ts`

```typescript
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import type { Logger as PinoLogger } from 'pino';

interface CacheEntry {
  value: string;
  stage: string;
}

interface GlobalWithApiKeyCache {
  __ceibaEmbeddingApiKeyCache?: CacheEntry;
}

const STAGE = process.env['STAGE'] ?? 'dev';
const IS_LOCAL = STAGE === 'local' || !process.env['AWS_ENDPOINT_URL']; // AWS_ENDPOINT_URL set by localstack

const SSM_CLIENT = new SSMClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
});

export async function resolveGeminiApiKey(logger: PinoLogger): Promise<string> {
  // Local / dev-server bypass
  if (IS_LOCAL) {
    const key = process.env['GEMINI_API_KEY'];
    if (!key) throw new EmbeddingProviderUnavailableError('gemini', 'missing-api-key');
    return key;
  }

  // globalThis cache (execution-environment lifetime)
  const g = globalThis as GlobalWithApiKeyCache;
  if (g.__ceibaEmbeddingApiKeyCache?.stage === STAGE) {
    logger.info({ provider: 'gemini', source: 'cache' }, 'Gemini API key resolved from cache');
    return g.__ceibaEmbeddingApiKeyCache.value;
  }

  const paramName = `/ceiba/${STAGE}/gemini-api-key`;
  const log = logger.child({ provider: 'gemini', ssmParam: paramName });

  try {
    const command = new GetParametersCommand({
      Names: [paramName],
      WithDecryption: true,
    });
    const result = await SSM_CLIENT.send(command);
    const param = result.Parameters?.[0];
    if (!param?.Value) {
      throw new EmbeddingProviderUnavailableError('gemini', 'ssm-param-not-found');
    }
    g.__ceibaEmbeddingApiKeyCache = { value: param.Value, stage: STAGE };
    log.info({ source: 'ssm' }, 'Gemini API key resolved from SSM');
    return param.Value;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error({ reason }, 'Failed to resolve Gemini API key from SSM');
    throw new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
  }
}
```

**Cache trade-off:** `globalThis` cache means SSM changes after Lambda warm-start do not apply until cold-start. This matches the existing pattern for JWT secrets in the codebase. Documented intentionally.

**Logger redaction:** `createLogger()` in `packages/backend/src/shared/logger.ts` must be extended with `redact: ['*.apiKey', '*.GEMINI_API_KEY', 'apiKey', 'GEMINI_API_KEY']` so `param.Value` never appears in CloudWatch.

**Test strategy:**

1. Mock `vi.mock('@aws-sdk/client-ssm')` — stub `SSMClient` and `GetParametersCommand`
2. First call: assert `send` called once, value cached in `globalThis`
3. Second call: assert `send` NOT called again (cache hit)
4. SSM error: assert `EmbeddingProviderUnavailableError` thrown with reason `'ssm-fetch-failed'`
5. `STAGE=local`: assert no SSM call, `process.env.GEMINI_API_KEY` returned

---

### R5: Drizzle Migration + Schema

**File:** `packages/backend/drizzle/0001_add_product_embedding.sql`

```sql
-- Add nullable vector(768) column to products table
-- Idempotent: safe to re-run on populated table
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(768);

-- HNSW index for cosine similarity search
-- IF NOT EXISTS makes this idempotent
CREATE INDEX IF NOT EXISTS products_embedding_hnsw
  ON products
  USING hnsw (embedding vector_cosine_ops);

-- pgvector extension is pre-enabled via:
--   docker/postgres-init/01-pgvector.sql  (local)
--   RDS default_extensions parameter group (AWS)
-- No CREATE EXTENSION here to keep migration portable
```

**File:** `packages/backend/src/db/schema.ts` (MODIFIED — add `embedding` to `products` table)

```typescript
import { customType } from 'drizzle-orm/pg-core';

// In the existing schema.ts, add this customType near the top:
const vector = customType<{ data: number[] }>({
  dataType: () => 'vector(768)',
});

// In the products table definition, add after supplier:
export const products = pgTable(
  'products',
  {
    // ... existing columns ...
    supplier: text('supplier').notNull(),
    embedding: vector('embedding'), // nullable, no .notNull()
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  } /* existing indexes */,
);
```

**Test strategy:** Integration test against real pgvector Postgres in CI (`DATABASE_URL` from Secrets Manager). Tests:

1. Run migration on clean DB → column exists, index exists
2. Re-run migration → no error (idempotency)
3. Insert product with NULL embedding → success
4. Insert product with valid 768-dim array → success, vector stored

---

### R6: ProductRepository.findByEmbedding

**File:** `packages/backend/src/products/domain/ports/product-repository.ts` (MODIFIED — add method)

```typescript
export interface ProductRepository {
  // ... existing methods ...
  findById(id: string): Promise<ProductProps | null>;
  findBySku(sku: string): Promise<ProductProps | null>;
  create(props: ProductProps): Promise<ProductProps>;
  update(
    id: string,
    partial: Partial<Omit<ProductProps, 'id' | 'sku' | 'stock' | 'createdAt'>>,
  ): Promise<ProductProps>;
  list(opts: ListOptions): Promise<Page<ProductProps>>;

  // NEW — R6
  findByEmbedding(
    embedding: number[],
    opts: { limit: number; minSimilarity?: number },
  ): Promise<ProductProps[]>;
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
}
```

**File:** `packages/backend/src/products/infrastructure/drizzle-product-repository.ts` (MODIFIED)

```typescript
// Add to DrizzleProductRepository class:

async findByEmbedding(
  embedding: number[],
  opts: { limit: number; minSimilarity?: number },
): Promise<ProductProps[]> {
  const limit = Math.max(1, Math.min(50, opts.limit));
  const minSim = opts.minSimilarity ?? 0.0;

  let query = db
    .select()
    .from(products)
    .where(sql`${products.embedding} IS NOT NULL`)
    .orderBy(sql`${products.embedding} <=> ${embedding}::vector`)
    .limit(limit);

  if (minSim > 0) {
    // distance <= (1 - minSimilarity)
    const maxDist = 1 - minSim;
    query = query.where(sql`1 - (1 - (${products.embedding} <=> ${embedding}::vector)) >= ${minSim}`);
  }

  const rows = await query;
  return rows.map(mapRowToProps);
}

async updateEmbedding(id: string, embedding: number[]): Promise<void> {
  await db
    .update(products)
    .set({ embedding: sql`${embedding}::vector` })
    .where(sql`${products.id} = ${id}`);
}
```

**SQL semantics:**

- `<=>` is cosine distance (lower = more similar)
- `ORDER BY embedding <=> $1::vector` returns most-similar-first
- `WHERE embedding IS NOT NULL` excludes unembedded products
- `1 - (embedding <=> $1::vector) >= $minSim` converts similarity threshold to max distance

**Test strategy:**

- **Unit:** stub `db` with in-memory mock, assert `limit` clamp behavior (call with 200 → SQL uses `LIMIT 50`)
- **Integration:** against real pgvector Postgres, insert 3 products with known embeddings, call `findByEmbedding`, assert correct ordering by cosine distance

---

### R7: CreateProductUseCase Integration

**File:** `packages/backend/src/products/application/create-product.ts` (MODIFIED)

```typescript
import type { EmbeddingPort } from '../domain/ports/embedding.js';

export class CreateProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryReadRepository,
    private readonly alertOpener: AlertOpenerPort,
    private readonly embedder?: EmbeddingPort, // NEW — optional injection
  ) {}

  async execute(input: CreateProductInput): Promise<Product> {
    // ... (existing aggregate creation + FK + SKU uniqueness + persist) ...
    const persisted = await this.products.create({/* ... */});

    // NEW: fire-and-forget embedding
    if (this.embedder) {
      const product = Product.rehydrate(persisted);
      setImmediate(() => embedInBackground(product, this.embedder!, this.products, logger));
    }

    // ... (existing alert opener + return) ...
    return Product.rehydrate(persisted);
  }
}

async function embedInBackground(
  product: Product,
  embedder: EmbeddingPort,
  repo: ProductRepository,
  log: PinoLogger,
): Promise<void> {
  const text = `${product.name} ${product.description ?? ''} ${product.supplier}`.trim();
  try {
    const vector = await embedder.embed(text);
    await repo.updateEmbedding(product.id, [...vector]); // spread to plain number[]
  } catch (err) {
    log.warn(
      {
        productId: product.id,
        provider: 'gemini',
        outcome: 'exhausted',
        reason: err instanceof Error ? err.message : String(err),
      },
      'Embedding computation failed after retries; embedding remains NULL',
    );
  }
}
```

**Test strategy:**

1. Stub `embeddingPort.embed()` returning a 768-dim vector → after `execute()`, assert `repo.updateEmbedding` was called with that vector (use `vi.useFakeTimers()` + `await vi.runAllTimersAsync()` if needed)
2. Stub `embeddingPort.embed()` throwing after 3 attempts → assert product still returned, `repo.updateEmbedding` NOT called, warning log captured

---

### R8: UpdateProductUseCase Integration

**File:** `packages/backend/src/products/application/update-product.ts` (MODIFIED)

```typescript
import type { EmbeddingPort } from '../domain/ports/embedding.js';

const EMBEDDING_TEXT_FIELDS = new Set<keyof UpdateProductInput>([
  'name',
  'description',
  'supplier',
]);

export class UpdateProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryReadRepository,
    private readonly alertReadModel: AlertReadModelPort,
    private readonly embedder?: EmbeddingPort, // NEW
  ) {}

  async execute(id: string, input: UpdateProductInput): Promise<Product> {
    const existing = await this.products.findById(id);
    if (!existing) throw new ProductNotFoundError(id);
    if (input.categoryId) {
      /* FK validation */
    }
    const updated = await this.products.update(id, input);
    const product = Product.rehydrate(updated);
    const hasActiveAlert = await this.alertReadModel.hasActiveAlert(id);

    // NEW: detect text-field changes → re-embed
    const triggersReembed =
      EMBEDDING_TEXT_FIELDS.has(input.name as 'name') ||
      EMBEDDING_TEXT_FIELDS.has(input.description as 'description') ||
      EMBEDDING_TEXT_FIELDS.has(input.supplier as 'supplier');
    // Note: input.name is typed as `string | undefined`, so Set.has returns false for undefined
    const shouldReembed =
      input.name !== undefined || input.description !== undefined || input.supplier !== undefined;
    if (shouldReembed && this.embedder) {
      setImmediate(() => embedInBackground(product, this.embedder, this.products, logger));
    }

    return product.withAlertFlag(hasActiveAlert);
  }
}
```

**Text-field detection logic:** `input.name !== undefined || input.description !== undefined || input.supplier !== undefined`. This triggers re-embed even if the new value equals the old value (safe side — the user explicitly sent the field). No detection of whether the _value_ changed at the string level.

**Test strategy:**

1. Spy on `setImmediate` / stub `embedInBackground` → assert called when `{ name: "New" }` passed
2. Spy → assert NOT called when `{ stock: 100 }` passed
3. No `embedder` injected → `embedInBackground` never called regardless of input

---

### R9: SemanticSearchUseCase

**File:** `packages/backend/src/products/application/semantic-search-products.ts` (NEW)

```typescript
import type { EmbeddingPort } from '../domain/ports/embedding.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import { Product } from '../domain/product.js';
import { InvalidSemanticSearchQueryError } from '../domain/errors/invalid-semantic-search-query.js';

export interface SemanticSearchInput {
  query: string;
  limit: number;
}

export interface SemanticSearchResult {
  items: Product[];
  total: number;
}

export class SemanticSearchUseCase {
  constructor(
    private readonly embedder: EmbeddingPort,
    private readonly productRepo: ProductRepository,
  ) {}

  async execute(input: SemanticSearchInput): Promise<SemanticSearchResult> {
    if (input.query.length < 3 || input.query.length > 1024) {
      throw new InvalidSemanticSearchQueryError(input.query);
    }
    const vector = await this.embedder.embed(input.query);
    const results = await this.productRepo.findByEmbedding([...vector], { limit: input.limit });
    return {
      items: results.map((r) => Product.rehydrate(r)),
      total: results.length,
    };
  }
}
```

**Test strategy:** Stub `embedder.embed()` returning `[0.1, 0.2, ..., 0.768]`. Stub `productRepo.findByEmbedding()`. Assert:

1. Happy path: results mapped correctly, `total` === `items.length`
2. Query `< 3` chars: `InvalidSemanticSearchQueryError` thrown, zero embed calls
3. Query `> 1024` chars: same error, zero embed calls
4. Embedder throws `EmbeddingProviderUnavailableError`: propagates, no `findByEmbedding` call

---

### R10: Semantic Search HTTP Handler

**File:** `packages/backend/src/products/interface/handlers/semantic-search-products.ts` (NEW)

```typescript
import type { APIGatewayProxyEventV2, Context as LambdaContext } from 'aws-lambda';
import { z } from 'zod';
import { SemanticSearchUseCase } from '../../application/semantic-search-products.js';
import { extractBearer, verifyJwt } from '../../../auth/interface/middleware/jwt.js';
import { toErrorResponse } from '../../../shared/error-mapper.js';
import type { ProductsBootstrap } from '../../bootstrap.js';

const SemanticSearchSchema = z.object({
  q: z.string().min(3).max(1024),
  limit: z.number().int().min(1).max(50).default(10),
});

export async function handler(
  event: APIGatewayProxyEventV2,
  _ctx: LambdaContext,
  bootstrap: ProductsBootstrap,
): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
  try {
    const token = extractBearer(event);
    await verifyJwt(token);

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = SemanticSearchSchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'INVALID_SEMANTIC_SEARCH_QUERY',
          message: 'Invalid query',
          details: parsed.error.flatten(),
        }),
      };
    }

    const { q, limit } = parsed.data;
    const useCase = new SemanticSearchUseCase(
      bootstrap.embeddingPort!, // injected at bootstrap time
      bootstrap.productRepo!,
    );
    const result = await useCase.execute({ query: q, limit });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: result.items, total: result.total }),
    };
  } catch (thrown) {
    if (thrown instanceof Error && thrown.name === 'EmbeddingProviderUnavailableError') {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'EMBEDDING_PROVIDER_UNAVAILABLE',
          provider: 'gemini',
          retryAfter: 60,
        }),
      };
    }
    return toErrorResponse(thrown, { requestId: event.requestContext.requestId ?? 'unknown' });
  }
}
```

**Note:** `ProductsBootstrap` must be extended to carry `embeddingPort` and `productRepo` so the handler can construct `SemanticSearchUseCase` without re-instantiating all dependencies.

**File:** `packages/backend/src/lambda/handler.ts` (MODIFIED)

```typescript
// Add to imports:
import { handler as semanticSearchProducts } from '../products/interface/handlers/semantic-search-products.js';

// Add to ROUTE_MAP:
'POST /api/v1/products/semantic-search': semanticSearchProducts as SubHandler,
```

**Test strategy:**

```typescript
import { handler } from './semantic-search-products.js';

vi.mock('../../../auth/interface/middleware/jwt.js', () => ({
  extractBearer: vi.fn(() => 'Bearer token'),
  verifyJwt: vi.fn(),
}));

it('returns 200 with items on valid query', async () => {
  const mockBootstrap = {
    embeddingPort: { embed: vi.fn().mockResolvedValue(Array(768).fill(0.1)) },
    productRepo: { findByEmbedding: vi.fn().mockResolvedValue([]) },
  };
  const event = { body: JSON.stringify({ q: 'laptop gaming', limit: 5 }) };
  const result = await handler(event, {} as any, mockBootstrap as any);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body)).toHaveProperty('items');
});

it('returns 400 when q is too short', async () => {
  const event = { body: JSON.stringify({ q: 'ab' }) };
  const result = await handler(event, {} as any, {} as any);
  expect(result.statusCode).toBe(400);
});

it('returns 503 when embedder throws EmbeddingProviderUnavailableError', async () => {
  const mockBootstrap = {
    embeddingPort: {
      embed: vi
        .fn()
        .mockRejectedValue(new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed')),
    },
    productRepo: { findByEmbedding: vi.fn() },
  };
  const event = { body: JSON.stringify({ q: 'laptop' }) };
  const result = await handler(event, {} as any, mockBootstrap as any);
  expect(result.statusCode).toBe(503);
  expect(JSON.parse(result.body).code).toBe('EMBEDDING_PROVIDER_UNAVAILABLE');
});
```

---

### R11: Bootstrap Wiring

**File:** `packages/backend/src/products/bootstrap.ts` (MODIFIED)

```typescript
import { resolveGeminiApiKey } from './infrastructure/embedding/api-key-resolver.js';
import { buildEmbeddingProvider } from './infrastructure/embedding/factory.js';
import { SemanticSearchUseCase } from './application/semantic-search-products.js';

export interface ProductsBootstrap {
  db: Db;
  logger: PinoLogger;
  createProduct: CreateProductUseCase;
  listProducts: ListProductsUseCase;
  getProduct: GetProductUseCase;
  updateProduct: UpdateProductUseCase;
  categoryReadRepository: DrizzleCategoryReadRepository;
  // NEW
  embeddingPort: EmbeddingPort | undefined; // undefined only if EMBEDDING_PROVIDER=disabled (future)
}

export function bootstrapProducts(dbOverride?: Db): ProductsBootstrap {
  const g = globalThis as GlobalWithProducts;
  if (g.__mercadoExpressProducts) return g.__mercadoExpressProducts;

  const db = dbOverride ?? getDb();
  const productRepo = new DrizzleProductRepository(db);
  const categoryRead = new DrizzleCategoryReadRepository(db);
  const alertReadModel = new DrizzleAlertReadModel(db);
  const alertOpener = new DrizzleAlertOpenerPort(db);
  const logger = createLogger().child({ bc: 'products' });

  // NEW: resolve API key at cold start
  const apiKeyPromise = resolveGeminiApiKey(logger);
  const provider = process.env['EMBEDDING_PROVIDER'] ?? 'gemini';
  const apiKey = await apiKeyPromise; // sync here so bootstrap fails at cold-start, not at first request

  // NEW: build EmbeddingPort singleton
  const embeddingPort = buildEmbeddingProvider({
    provider,
    apiKey,
    logger,
  });

  const bootstrap: ProductsBootstrap = {
    db,
    logger,
    createProduct: new CreateProductUseCase(productRepo, categoryRead, alertOpener, embeddingPort),
    listProducts: new ListProductsUseCase(productRepo, alertReadModel),
    getProduct: new GetProductUseCase(productRepo, alertReadModel),
    updateProduct: new UpdateProductUseCase(
      productRepo,
      categoryRead,
      alertReadModel,
      embeddingPort,
    ),
    categoryReadRepository: categoryRead,
    embeddingPort,
  };

  g.__mercadoExpressProducts = bootstrap;
  return bootstrap;
}
```

**Test strategy:**

1. Mock `resolveGeminiApiKey` returning `'sk-test-key'`
2. Mock `buildEmbeddingProvider` returning a stub `EmbeddingPort`
3. Call `bootstrapProducts()` twice
4. Assert `resolveGeminiApiKey` called once, `buildEmbeddingProvider` called once
5. Assert second call returns same object reference (singleton)

---

### R12: Hexagonal Layer Discipline

**File:** `packages/backend/test/architecture/embedding-layer-discipline.test.ts` (NEW)

```typescript
/**
 * Architectural test: embedding layer discipline (R12).
 *
 * Asserts that no AI SDK imports or process.env references exist in
 * domain/ or application/ layers of the products BC. Pattern mirrors
 * cross-bc-bounds.test.ts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const BACKEND_SRC = join(process.cwd(), 'packages', 'backend', 'src');
const PRODUCTS_DIR = join(BACKEND_SRC, 'products');

const FORBIDDEN_SDKS = [
  '@google/generative-ai',
  '@google-cloud/vertexai',
  'openai',
  '@anthropic-ai/sdk',
  'voyageai',
  'ollama',
];

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, acc);
    else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

const importRe = /import\s+.*?from\s+['"]([^'"]+)['"]/g;

describe('embedding layer discipline', () => {
  it('domain/ contains zero SDK imports', () => {
    const domainDir = join(PRODUCTS_DIR, 'domain');
    const files = listFiles(domainDir);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(importRe)) {
        const spec = match[1] ?? '';
        if (FORBIDDEN_SDKS.some((sdk) => spec.startsWith(sdk))) {
          offenders.push(`${relative(process.cwd(), file)}: imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('application/ contains zero SDK imports', () => {
    const appDir = join(PRODUCTS_DIR, 'application');
    const files = listFiles(appDir);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(importRe)) {
        const spec = match[1] ?? '';
        if (FORBIDDEN_SDKS.some((sdk) => spec.startsWith(sdk))) {
          offenders.push(`${relative(process.cwd(), file)}: imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('domain/ contains zero process.env references', () => {
    const domainDir = join(PRODUCTS_DIR, 'domain');
    const files = listFiles(domainDir);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      if (/process\.env\b/.test(text)) {
        offenders.push(`${relative(process.cwd(), file)}: references process.env`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

**Test strategy:** Introduce a temporary forbidden import in `application/create-product.ts` → assert test fails. Remove it → assert test passes. This is run as part of the standard CI suite.

---

## 4. Configuration

### 4.1 New Environment Variables

**File:** `.env.dev.example` (MODIFIED)

```env
# Embedding provider selection (Phase 1: gemini only)
EMBEDDING_PROVIDER=gemini

# Gemini API key (local dev only — AWS uses SSM /ceiba/{stage}/gemini-api-key)
GEMINI_API_KEY=sk-gemini-your-key-here

# Per-provider keys (only the active one is read by the factory)
# OPENAI_API_KEY=sk-...          # future
# OLLAMA_BASE_URL=http://localhost:11434  # future
# VOYAGE_API_KEY=pa-...           # future

# SSM path (AWS Lambda only; local and localstack ignore this)
SSM_GEMINI_KEY_PATH=/ceiba/${STAGE}/gemini-api-key
```

**File:** `.env.example` (MODIFIED — same content minus values)

### 4.2 CDK Changes

**File:** `packages/infra/src/stacks/DatabaseStack.ts` (MODIFIED)

```typescript
import { StringParameter, SecureString } from 'aws-cdk-lib/aws-ssm';

// Inside the stack constructor or a new addGeminiApiKey() method:
new StringParameter(this, 'GeminiApiKeyParam', {
  parameterName: `/ceiba/${stage}/gemini-api-key`,
  stringValue: 'PLACEHOLDER_REPLACE_AT_DEPLOY', // updated via CI secret injection
  type: ssm.ParameterType.SECURE_STRING,
  description: 'Gemini API key for product semantic search',
  tier: ssm.ParameterTier.STANDARD,
});
```

**Note:** The SSM parameter value should be injected via CI (AWS Secrets Manager → Systems Manager → Parameter Store) or directly at deploy time from a CI secret. CDK cannot store the actual key in the template.

**File:** `packages/infra/src/stacks/ApiStack.ts` (MODIFIED)

```typescript
// 1. Add to LAMBDAS[0].routes:
{ path: '/api/v1/products/semantic-search', methods: [apigwv2.HttpMethod.POST] },

// 2. In the Lambda environment props, add:
environment: {
  EMBEDDING_PROVIDER: stageConfig.embeddingProvider ?? 'gemini',
  // STAGE already passed via context
},

// 3. Add IAM permission to the Lambda's role (find via findRole() or inline policy):
const apiRole = lambdaFn.role!;
apiRole.addToPrincipalPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/ceiba/${stage}/gemini-api-key`,
  ],
}));
```

---

## 5. Error Handling

### 5.1 New Errors

**File:** `packages/backend/src/products/domain/errors/embedding-provider-unavailable.ts`

```typescript
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { ErrorCode } from '@mercadoexpress/shared';

export class EmbeddingProviderUnavailableError extends BaseDomainError {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
  ) {
    super({
      code: ErrorCode.EMBEDDING_PROVIDER_UNAVAILABLE,
      httpStatus: 503,
      message: `Embedding provider '${provider}' is unavailable: ${reason}`,
      details: { provider, reason },
    });
  }
}
```

**File:** `packages/backend/src/products/domain/errors/embedding-input-too-long.ts`

```typescript
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { ErrorCode } from '@mercadoexpress/shared';

export class EmbeddingInputTooLongError extends BaseDomainError {
  constructor(public readonly length: number) {
    super({
      code: ErrorCode.EMBEDDING_INPUT_TOO_LONG,
      httpStatus: 400,
      message: `Embedding input exceeds maximum length of 8192 characters (got ${length})`,
      details: { length },
    });
  }
}
```

**File:** `packages/backend/src/products/domain/errors/invalid-semantic-search-query.ts`

```typescript
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';
import { ErrorCode } from '@mercadoexpress/shared';

export class InvalidSemanticSearchQueryError extends BaseDomainError {
  constructor(public readonly query: string) {
    super({
      code: ErrorCode.INVALID_SEMANTIC_SEARCH_QUERY,
      httpStatus: 400,
      message: 'Query must be between 3 and 1024 characters',
      details: { queryLength: query.length },
    });
  }
}
```

### 5.2 Error Codes

**File:** `packages/shared/src/errors/errorCodes.ts` (MODIFIED)

```typescript
export const ErrorCode = {
  // ... existing codes ...
  EMBEDDING_PROVIDER_UNAVAILABLE: 'EMBEDDING_PROVIDER_UNAVAILABLE',
  EMBEDDING_INPUT_TOO_LONG: 'EMBEDDING_INPUT_TOO_LONG',
  INVALID_SEMANTIC_SEARCH_QUERY: 'INVALID_SEMANTIC_SEARCH_QUERY',
} as const;
```

### 5.3 Error Matrix

| Error class                         | HTTP | Error code                       | Origin                                                               |
| ----------------------------------- | ---- | -------------------------------- | -------------------------------------------------------------------- |
| `EmbeddingProviderUnavailableError` | 503  | `EMBEDDING_PROVIDER_UNAVAILABLE` | `GeminiApiKeyResolver`, `EmbeddingFactory`, `GeminiEmbeddingAdapter` |
| `EmbeddingInputTooLongError`        | 400  | `EMBEDDING_INPUT_TOO_LONG`       | `GeminiEmbeddingAdapter.embed()`                                     |
| `InvalidSemanticSearchQueryError`   | 400  | `INVALID_SEMANTIC_SEARCH_QUERY`  | `SemanticSearchUseCase.execute()`                                    |

### 5.4 Error Mapper Update

**File:** `packages/backend/src/shared/error-mapper.ts` (MODIFIED)

```typescript
// Add to imports:
import { EmbeddingProviderUnavailableError } from '../../products/domain/errors/embedding-provider-unavailable.js';

// Add to toErrorResponse():
if (thrown instanceof EmbeddingProviderUnavailableError) {
  const envelope: ErrorEnvelope = {
    code: ErrorCode.EMBEDDING_PROVIDER_UNAVAILABLE,
    message: thrown.message,
    details: { provider: thrown.provider, reason: thrown.reason, retryAfter: 60 },
    requestId,
  };
  ctx.log?.info({ requestId, code: thrown.code, httpStatus: 503 }, 'mapped embedding error');
  return envelopeToResponse(envelope, 503);
}
```

---

## 6. Test Strategy

### 6.1 Unit Tests

| File                                                  | New? | Tool   | Pattern                                                                   |
| ----------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------- |
| `infrastructure/embedding/gemini-adapter.test.ts`     | NEW  | Vitest | Fake `httpClient` injection, assert retry count + log redaction           |
| `infrastructure/embedding/factory.test.ts`            | NEW  | Vitest | Mock `GeminiEmbeddingAdapter`, assert singleton + unknown provider throw  |
| `infrastructure/embedding/api-key-resolver.test.ts`   | NEW  | Vitest | `vi.mock('@aws-sdk/client-ssm')`, assert cache hit on second call         |
| `application/create-product.embedding.test.ts`        | NEW  | Vitest | Manual `EmbeddingPort` stub, assert `updateEmbedding` called / not called |
| `application/update-product.embedding.test.ts`        | NEW  | Vitest | Spy `setImmediate`, assert triggered by text fields, not by stock         |
| `application/semantic-search-products.test.ts`        | NEW  | Vitest | Stub embedder + repo, assert result shape + validation                    |
| `interface/handlers/semantic-search-products.test.ts` | NEW  | Vitest | `vi.mock` JWT + bootstrap, assert status codes per error type             |
| `architecture/embedding-layer-discipline.test.ts`     | NEW  | Vitest | `readdirSync` + regex scan, assert zero forbidden imports                 |

### 6.2 Integration Tests

| File                                                          | Requires                  | Tool             |
| ------------------------------------------------------------- | ------------------------- | ---------------- |
| `infrastructure/drizzle-product-repository.embedding.test.ts` | `DATABASE_URL` (pgvector) | Vitest + real DB |

Tests against real Postgres with pgvector. Verifies: vector column created, `findByEmbedding` ordering, NULL exclusion, idempotent migration re-run.

### 6.3 Coverage Targets

| Layer          | Target | Notes                                            |
| -------------- | ------ | ------------------------------------------------ |
| Domain         | 100%   | Entities + ports — all code paths must be tested |
| Application    | 95%    | Use cases — include error paths                  |
| Infrastructure | 90%    | Adapters — fake HTTP, mock SSM                   |
| Interface      | 85%    | Handlers — status codes per error type           |

### 6.4 Mocking Rules

- **`EmbeddingPort`**: manual stub objects implementing the interface. Never `vi.mock()` the interface itself.
- **`@google/generative-ai`**: NEVER mocked directly. The adapter accepts `httpClient` injection so tests inject a fake.
- **`@aws-sdk/client-ssm`**: `vi.mock()` for unit tests; real client in integration tests.
- **Real SDK calls**: never in unit tests. Reserved for manual smoke tests with real credentials.

---

## 7. Migration / Rollout

### 7.1 Database Migration

- Run via existing `.github/workflows/migrate.yml`: `pnpm --filter @mercadoexpress/backend db:migrate`
- `0001_add_product_embedding.sql` is idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- Safe to re-run on populated table
- Backward compatible: existing products get `NULL` embedding; semantic search excludes them
- Backfill (future): a separate batch job (NOT in this PR) can re-embed NULL rows

### 7.2 CDK Deployment Order

**Atomic PR strategy (single PR):**

1. Deploy SSM parameter first (separate `cdk deploy DatabaseStack` or add to this stack)
2. Deploy Lambda (ApiStack) with new route + IAM permission

**Recommended:** Include both in this PR for atomicity. SSM parameter with a placeholder value is safe to deploy before the Lambda; the Lambda handles missing/placeholder keys gracefully (throws at cold-start, not at request-time).

### 7.3 Rollback

| What         | Rollback action                                                                              |
| ------------ | -------------------------------------------------------------------------------------------- |
| Code         | `cdk deploy` previous commit — CloudFormation reverts Lambda                                 |
| DB           | Do NOT drop `embedding` column — safe to keep. Products with NULL embeddings work fine.      |
| Feature flag | Not added in Phase 1. Future: `EMBEDDING_PROVIDER=disabled` at factory level short-circuits. |

---

## 8. Out of Scope

The following are explicitly NOT implemented in this PR:

- Re-embed batch endpoint (user rejected — backlog only)
- `ChatPort` / LLM invocation port
- OpenAI, Ollama, Voyage adapters (architecture supports them; Phase 1 ships Gemini only)
- Frontend UI wiring
- Redis / in-memory embedding cache
- Custom rate limits on `/semantic-search` (uses API Gateway defaults)
- OpenTelemetry / X-Ray sub-segments
- NOT NULL constraint on `embedding` column
- Cross-BC embedding reuse (embeddings are products BC-scoped)
- Synchronous embedding on write (explicitly rejected — would add p99 latency)
- `pg-mem` for integration tests (pgvector ops not supported; use real Postgres in CI)

---

## 9. Open Questions

All 8 open questions from the proposal have been resolved by the spec or are deferred to future phases:

| #   | Question                                     | Resolution                                                               |
| --- | -------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Text concatenation format                    | `name + " " + description + " " + supplier` (single space, no separator) |
| 2   | Long descriptions >8192 chars                | `EmbeddingInputTooLongError` thrown at adapter entry — no truncation     |
| 3   | Concurrency limit for background embeddings  | Deferred — no throttle in Phase 1                                        |
| 4   | Drizzle customType for vector(768)           | `customType<{ data: number[] }>({ dataType: () => 'vector(768)' })`      |
| 5   | Auth scope for `/semantic-search`            | Same JWT as other product endpoints                                      |
| 6   | pg-mem support for vector ops                | NOT used — integration tests against real pgvector Postgres              |
| 7   | What fields trigger re-embed                 | `name`, `description`, `supplier` — detected by `!== undefined` check    |
| 8   | CloudWatch metric `embedding_attempts_total` | NOT in this PR                                                           |

---

## 10. Phase Transition

- **Next:** `sdd-tasks` — mechanical breakdown of all components into ordered, testable tasks
- **After tasks:** `sdd-apply` — implementation
- **After apply:** `sdd-verify` — validation against the 12 requirements and 42 scenarios
- **After verify:** `sdd-archive` — close the change

---

## Appendix A: File Summary

| File                                                           | Status   | Lines (est.)     |
| -------------------------------------------------------------- | -------- | ---------------- |
| `src/products/domain/ports/embedding.ts`                       | NEW      | 10               |
| `src/products/domain/errors/embedding-provider-unavailable.ts` | NEW      | 20               |
| `src/products/domain/errors/embedding-input-too-long.ts`       | NEW      | 15               |
| `src/products/domain/errors/invalid-semantic-search-query.ts`  | NEW      | 15               |
| `src/products/application/semantic-search-products.ts`         | NEW      | 35               |
| `src/products/application/create-product.ts`                   | MODIFIED | +20              |
| `src/products/application/update-product.ts`                   | MODIFIED | +15              |
| `src/products/infrastructure/embedding/gemini-adapter.ts`      | NEW      | 80               |
| `src/products/infrastructure/embedding/factory.ts`             | NEW      | 35               |
| `src/products/infrastructure/embedding/api-key-resolver.ts`    | NEW      | 60               |
| `src/products/infrastructure/drizzle-product-repository.ts`    | MODIFIED | +25              |
| `src/products/interface/handlers/semantic-search-products.ts`  | NEW      | 60               |
| `src/products/bootstrap.ts`                                    | MODIFIED | +15              |
| `src/lambda/handler.ts`                                        | MODIFIED | +1 (route entry) |
| `src/shared/error-mapper.ts`                                   | MODIFIED | +10              |
| `src/db/schema.ts`                                             | MODIFIED | +10              |
| `drizzle/0001_add_product_embedding.sql`                       | NEW      | 10               |
| `test/architecture/embedding-layer-discipline.test.ts`         | NEW      | 70               |
| `test/.../drizzle-product-repository.embedding.test.ts`        | NEW      | 50               |
| `test/.../gemini-adapter.test.ts`                              | NEW      | 80               |
| `test/.../factory.test.ts`                                     | NEW      | 40               |
| `test/.../api-key-resolver.test.ts`                            | NEW      | 60               |
| `test/.../create-product.embedding.test.ts`                    | NEW      | 50               |
| `test/.../update-product.embedding.test.ts`                    | NEW      | 50               |
| `test/.../semantic-search-products.test.ts`                    | NEW      | 40               |
| `test/.../semantic-search-products.handler.test.ts`            | NEW      | 50               |
| `packages/shared/src/errors/errorCodes.ts`                     | MODIFIED | +3 lines         |
| `.env.dev.example`                                             | MODIFIED | +5 lines         |
| `packages/infra/src/stacks/ApiStack.ts`                        | MODIFIED | +5 lines         |
| `packages/infra/src/stacks/DatabaseStack.ts`                   | MODIFIED | +10 lines        |
| **Total new files:** 18                                        |          |                  |
| **Total modified files:** 10                                   |          |                  |

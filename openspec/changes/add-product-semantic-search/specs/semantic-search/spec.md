# Semantic Search Specification

## Purpose

Adds meaning-based product retrieval to the products bounded context. A new endpoint (`POST /api/v1/products/semantic-search`) accepts a natural-language query, embeds it using a configurable AI provider, and returns products ordered by cosine similarity. Embeddings are computed asynchronously on product create/update with a fail-open retry policy. Provider selection is driven entirely by the `EMBEDDING_PROVIDER` environment variable; domain and application layers contain zero concrete AI SDK imports.

---

## Requirements

### Requirement 1: EmbeddingPort Contract

The system MUST provide a pure interface `EmbeddingPort` in the domain layer that abstracts all embedding operations, regardless of the underlying AI provider.

The port surface is:

```typescript
interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

- `embed(text)` MUST return a `Promise` resolving to a `readonly number[]` of exactly 768 dimensions.
- `embedBatch(texts)` MUST return a `Promise` resolving to a `readonly (readonly number[])[]` — one 768-dim vector per input string, in the same order.
- Dimension validation (768) is the adapter's responsibility; the port contract does not validate dimensions.
- The port lives in `products/domain/ports/embedding.ts`. No concrete SDK is imported here.

#### Scenario 1.1: embed(text) returns a 768-dimension vector

**Given** an `EmbeddingPort` stub returning `[0.1, 0.2, ..., 0.768]` (768 elements)
**When** `embed("laptop para gaming")` is called
**Then** the returned promise resolves to an array of length 768
**And** every element is a number in the range `[-1, 1]`

#### Scenario 1.2: embedBatch([t1, t2]) returns parallel arrays in order

**Given** an `EmbeddingPort` stub returning `[[0.1, ..., 0.768], [0.2, ..., 0.769]]` for two inputs
**When** `embedBatch(["text one", "text two"])` is called
**Then** the returned promise resolves to an array of length 2
**And** the first element corresponds to "text one"
**And** the second element corresponds to "text two"
**And** each sub-array has exactly 768 elements

---

### Requirement 2: GeminiEmbeddingAdapter

The system MUST provide `GeminiEmbeddingAdapter` in the infrastructure layer that implements `EmbeddingPort` against the `@google/generative-ai` SDK.

- Constructor accepts `{ apiKey: string }`. The `apiKey` value MUST NOT appear in any log output.
- `embed(text)` calls the Gemini embeddings API and returns a `Promise<number[]>` of length 768.
- `embedBatch(texts)` calls the Gemini embeddings API in parallel for all texts.
- Retry policy: 3 attempts with exponential backoff delays of 1 s, 2 s, and 4 s. The first attempt is made immediately; each retry waits for the configured delay before reattempting.
- After all 3 attempts are exhausted, `embed`/`embedBatch` MUST throw `EmbeddingProviderUnavailable(provider='gemini', reason: string)`.
- The adapter MUST log the HTTP status code and response byte length on success — but MUST NOT log the API key, request body, or response body.
- Input validation: if `text` exceeds 8192 characters, `embed` MUST throw `EmbeddingInputTooLong(text.length)`.

#### Scenario 2.1: Successful single embed

**Given** the Gemini API is reachable and returns a valid 768-dim embedding for "laptop gaming"
**When** `embed("laptop gaming")` is called
**Then** the returned promise resolves to an array of length 768
**And** no API key appears in any log line

#### Scenario 2.2: Batch embed returns matching-length parallel array

**Given** the Gemini API is reachable and returns valid embeddings for ["text a", "text b", "text c"]
**When** `embedBatch(["text a", "text b", "text c"])` is called
**Then** the returned promise resolves to an array of length 3
**And** each sub-array has exactly 768 elements

#### Scenario 2.3: First attempt fails, second attempt succeeds

**Given** the Gemini API fails on the first call with HTTP 429, then succeeds on the second call
**When** `embed("laptop gaming")` is called
**Then** the call succeeds after one retry
**And** exactly one retry occurred
**And** the result is a 768-dim vector

#### Scenario 2.4: All 3 attempts fail, then throws EmbeddingProviderUnavailable

**Given** the Gemini API returns HTTP 500 on every attempt
**When** `embed("laptop gaming")` is called
**Then** exactly 3 HTTP requests are made
**And** the promise rejects with `EmbeddingProviderUnavailable(provider='gemini', reason)`
**And** the reason string contains the HTTP status code

#### Scenario 2.5: Input longer than 8192 characters throws EmbeddingInputTooLong

**Given** a string of 8193 characters is provided
**When** `embed(longString)` is called
**Then** the promise rejects with `EmbeddingInputTooLong(8193)`
**And** no HTTP request is made to the Gemini API

#### Scenario 2.6: API key never appears in logs

**Given** the adapter is constructed with `{ apiKey: "sk-gemini-secret-xyz" }`
**When** `embed("test")` is called (succeeding or failing)
**Then** no log line contains the substring "sk-gemini-secret-xyz"
**And** no log line contains the request body or response body

---

### Requirement 3: EmbeddingFactory

The system MUST provide `EmbeddingFactory` that builds the correct `EmbeddingPort` implementation based on the `EMBEDDING_PROVIDER` environment variable.

- `buildEmbeddingProvider(settings: { provider: string; apiKey?: string; ...providerSpecific: Record<string, string> })` returns an `EmbeddingPort`.
- The factory selects the adapter via a switch on `settings.provider`.
- Unknown provider name → factory throws `EmbeddingProviderUnavailable(provider, reason='unknown-provider')` at construction time.
- For `gemini`: requires `apiKey` in settings; throws `EmbeddingProviderUnavailable(provider='gemini', reason='missing-api-key')` at construction if absent.
- The factory returns a singleton instance per provider name (memoized). All subsequent calls for the same provider return the identical object reference.
- Adding a new provider requires a new adapter file and one factory entry — no changes to domain or application layers.

#### Scenario 3.1: EMBEDDING_PROVIDER=gemini returns Gemini adapter

**Given** `settings = { provider: 'gemini', apiKey: 'sk-test-key' }`
**When** `buildEmbeddingProvider(settings)` is called
**Then** the returned object implements `EmbeddingPort`
**And** `embed("test")` calls the Gemini API

#### Scenario 3.2: Unknown provider throws at construction

**Given** `settings = { provider: 'unknown-provider', apiKey: 'sk-test' }`
**When** `buildEmbeddingProvider(settings)` is called
**Then** it throws `EmbeddingProviderUnavailable(provider='unknown-provider', reason='unknown-provider')`

#### Scenario 3.3: gemini without apiKey throws at construction

**Given** `settings = { provider: 'gemini' }` (no apiKey)
**When** `buildEmbeddingProvider(settings)` is called
**Then** it throws `EmbeddingProviderUnavailable(provider='gemini', reason='missing-api-key')`

#### Scenario 3.4: Same instance returned on repeat calls (singleton)

**Given** `settings = { provider: 'gemini', apiKey: 'sk-test' }`
**When** `buildEmbeddingProvider(settings)` is called twice
**Then** both calls return the exact same object reference
**And** no second adapter instance is created

---

### Requirement 4: SSM API Key Resolution

The system MUST provide `GeminiApiKeyResolver` in the infrastructure layer that resolves the Gemini API key from AWS SSM Parameter Store (production) or the local environment (development).

- SSM path: `/ceiba/{stage}/gemini-api-key` where `stage` is read from the `STAGE` environment variable.
- The resolved value is cached in `globalThis.__geminiApiKey` for the Lambda execution environment lifetime. Subsequent calls within the same cold-start return the cached value without calling SSM.
- Local development: when `STAGE=local` or `AWS_ENDPOINT_URL` is not set, the resolver reads directly from `process.env.GEMINI_API_KEY` without calling SSM.
- On SSM fetch failure (network error, permission error, parameter not found): throws `EmbeddingProviderUnavailable(provider='gemini', reason='ssm-fetch-failed')`.
- The API key value MUST NOT appear in any log output (pino redaction config).

#### Scenario 4.1: SSM path resolves and caches on second call

**Given** `STAGE=dev` and the SSM parameter `/ceiba/dev/gemini-api-key` resolves to "sk-gemini-dev-123"
**When** `resolveApiKey()` is called twice in the same Lambda execution
**Then** the SSM API is called exactly once
**And** both calls return "sk-gemini-dev-123"

#### Scenario 4.2: SSM error throws EmbeddingProviderUnavailable

**Given** `STAGE=dev` and the SSM call returns an access denied error
**When** `resolveApiKey()` is called
**Then** it throws `EmbeddingProviderUnavailable(provider='gemini', reason='ssm-fetch-failed')`

#### Scenario 4.3: Local stage reads GEMINI_API_KEY directly

**Given** `STAGE=local` and `process.env.GEMINI_API_KEY` is "sk-gemini-local"
**When** `resolveApiKey()` is called
**Then** it returns "sk-gemini-local"
**And** no SSM call is made

#### Scenario 4.4: API key never logged

**Given** a resolved API key value "sk-gemini-dev-123"
**When** `resolveApiKey()` is called and completes (success or failure)
**Then** no log line contains "sk-gemini-dev-123"
**And** pino redaction is configured to strip values matching the key pattern

---

### Requirement 5: Drizzle Migration (Idempotency + HNSW Index)

The system MUST provide a Drizzle migration `0001_add_product_embedding.sql` that adds the embedding column and HNSW index to the `products` table idempotently.

- `ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(768);` — the column is nullable with no default value.
- `CREATE INDEX IF NOT EXISTS products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops);`
- The migration MUST succeed when re-run on a populated table.
- The Drizzle schema MUST use a `customType` helper with `dataType: () => 'vector(768)'`.
- No `NOT NULL` constraint on the `embedding` column.

#### Scenario 5.1: Re-running migration on a populated table succeeds (idempotent)

**Given** the `products` table has rows and the `embedding` column already exists
**When** `0001_add_product_embedding.sql` is applied a second time
**Then** the migration completes without error
**And** existing rows are unchanged

#### Scenario 5.2: Vector column accepts NULL

**Given** a new product is created without an embedding value
**When** the product is persisted
**Then** the `embedding` column stores `NULL`
**And** no default value is applied

#### Scenario 5.3: HNSW index created with cosine distance operator

**Given** the migration has been applied
**When** `SELECT indexname FROM pg_indexes WHERE tablename = 'products' AND indexname = 'products_embedding_hnsw'` is run
**Then** the index `products_embedding_hnsw` exists
**And** its access method is `hnsw`
**And** its operator class is `vector_cosine_ops`

---

### Requirement 6: ProductRepository.findByEmbedding

The system MUST extend the `ProductRepository` interface with `findByEmbedding` for similarity search.

- Signature: `findByEmbedding(embedding: number[], opts: { limit: number; minSimilarity?: number }): Promise<ProductProps[]>`
- Uses the pgvector `<=>` (cosine distance) operator: `ORDER BY embedding <=> $1::vector LIMIT $2`.
- Rows where `embedding IS NULL` are excluded from results.
- Results are ordered by ascending distance (lower distance = more similar).
- `minSimilarity`: if provided, excludes rows where distance is greater than `(1 - minSimilarity)`. Defaults to `0.0` (no minimum filter).
- `limit` is clamped to the range `[1, 50]` before the query runs.

#### Scenario 6.1: Find similar products by cosine distance

**Given** 3 products exist with pre-computed embeddings: P1 (distance 0.1), P2 (distance 0.4), P3 (distance 0.2) from the query vector
**When** `findByEmbedding(queryVector, { limit: 10 })` is called
**Then** the returned array has length 3
**And** the first item is P1 (most similar)
**And** the second item is P3
**And** the third item is P2

#### Scenario 6.2: NULL embeddings are excluded

**Given** 5 products exist: 3 with embeddings and 2 without
**When** `findByEmbedding(queryVector, { limit: 10 })` is called
**Then** the returned array has length 3
**And** no item has a NULL embedding field

#### Scenario 6.3: limit is clamped to [1, 50]

**Given** 100 products exist with embeddings
**When** `findByEmbedding(queryVector, { limit: 200 })` is called
**Then** the SQL query uses `LIMIT 50`
**And** the returned array has at most 50 items

#### Scenario 6.4: minSimilarity filter is applied

**Given** 5 products exist with distances [0.1, 0.2, 0.3, 0.4, 0.5] from the query vector
**When** `findByEmbedding(queryVector, { limit: 10, minSimilarity: 0.7 })` is called (threshold = 0.3)
**Then** only products with distance ≤ 0.3 are returned
**And** the returned array has at most 3 items

---

### Requirement 7: CreateProductUseCase Integration

The system MUST trigger embedding computation asynchronously after a product is successfully created.

- After `repository.create()` resolves, the use case fires `embedProductInBackground(product)` via `setImmediate` (fallback: `Promise.resolve().then()`).
- The fire-and-forget path: calls `embedder.embed(text)` with the retry policy (3 attempts, 1s/2s/4s).
  - On success: calls `repository.updateEmbedding(product.id, embedding)`.
  - On final failure (all retries exhausted): logs a warning, leaves `embedding` as `NULL`, does NOT throw.
- The use case returns the `Product` read model immediately without awaiting the embedding.
- No new error thrown from the embedding path may cause the create response to fail.

#### Scenario 7.1: Product created, embedding populated within 5 seconds

**Given** a valid product create request with `name="Laptop Gamer"`, `description="16GB RAM, RTX 4060"`, `supplier="ACME"`
**When** `CreateProductUseCase.execute(input)` is called
**Then** the use case returns a product with the correct id, sku, and name within 500 ms
**And** within 5 seconds the `embedding` column for that product is non-NULL
**And** the embedding is a 768-dim vector

#### Scenario 7.2: Gemini unavailable, product created with NULL embedding

**Given** Gemini API is unreachable for all 3 retry attempts
**When** `CreateProductUseCase.execute(input)` is called
**Then** the use case returns a valid product response (201 equivalent)
**And** the product row exists in the database with `embedding = NULL`
**And** a warning is logged stating the embedding could not be computed
**And** no error is surfaced to the HTTP response

#### Scenario 7.3: Use case returns before embedding completes

**Given** Gemini API has a 10-second artificial delay
**When** `CreateProductUseCase.execute(input)` is called
**Then** the promise resolves within 2 seconds
**And** the returned product is fully populated
**And** the embedding field is not part of the return contract

---

### Requirement 8: UpdateProductUseCase Integration

The system MUST re-compute the embedding when a product's text fields used in the embedding change.

- Embedding text fields are: `name`, `description`, `supplier`.
- If the update input includes any of these fields (even if the new value equals the old value), the re-embed path is triggered.
- If the update input does NOT include any of these fields (e.g., only `stock` or `price` changes), the re-embed path MUST NOT be triggered.
- The same fire-and-forget pattern (retry policy, fail-open, no error leakage) applies as in create.

#### Scenario 8.1: Update name triggers re-embed

**Given** a product with an existing embedding exists
**When** `UpdateProductUseCase.execute(id, { name: "New Laptop Name" })` is called
**Then** the product is updated and returned
**And** the re-embed fire-and-forget path is invoked
**And** within 5 seconds the `embedding` column reflects the new name

#### Scenario 8.2: Update stock alone does NOT trigger re-embed

**Given** a product with an existing embedding exists
**When** `UpdateProductUseCase.execute(id, { stock: 150 })` is called
**Then** the product is updated and returned
**And** the re-embed path is NOT invoked
**And** the existing `embedding` value is unchanged

#### Scenario 8.3: Update description triggers re-embed

**Given** a product with an existing embedding exists
**When** `UpdateProductUseCase.execute(id, { description: "Updated description for the product" })` is called
**Then** the re-embed fire-and-forget path is invoked
**And** within 5 seconds the `embedding` column is updated

---

### Requirement 9: SemanticSearchUseCase

The system MUST provide `SemanticSearchUseCase` that executes a semantic search over the product catalog.

- Input: `{ query: string, limit: number }`.
- Validates `query.length >= 3` and `<= 1024`; throws `InvalidSemanticSearchQuery` on violation.
- Calls `embedder.embed(query)` with the retry policy (3 attempts, 1s/2s/4s). This call is blocking — the use case does not return until the embedding is computed.
- Throws `EmbeddingProviderUnavailable` if all retries are exhausted.
- Calls `repository.findByEmbedding(embedding, { limit })` and maps results to `Product` read models.
- Returns `{ items: Product[], total: number }` where `total = items.length` for Phase 1.

#### Scenario 9.1: Valid query returns similar products

**Given** 20 products exist with embeddings, and a query "zapatos de cuero para dama" embeds to a vector close to product P1
**When** `SemanticSearchUseCase.execute({ query: "zapatos de cuero para dama", limit: 10 })` is called
**Then** the result has `items` ordered by cosine similarity descending
**And** `total` equals the number of returned items
**And** products with `NULL` embedding are not in the result

#### Scenario 9.2: Query shorter than 3 characters rejected with InvalidSemanticSearchQuery

**Given** a query of 2 characters "ab"
**When** `SemanticSearchUseCase.execute({ query: "ab", limit: 10 })` is called
**Then** it throws `InvalidSemanticSearchQuery`
**And** no embedding call is made

#### Scenario 9.3: Query longer than 1024 characters rejected

**Given** a query of 1025 characters
**When** `SemanticSearchUseCase.execute({ query: longString, limit: 10 })` is called
**Then** it throws `InvalidSemanticSearchQuery`

#### Scenario 9.4: Gemini down, all retries exhausted throws EmbeddingProviderUnavailable

**Given** Gemini API is unreachable for all 3 retry attempts
**When** `SemanticSearchUseCase.execute({ query: "laptop gaming", limit: 10 })` is called
**Then** it throws `EmbeddingProviderUnavailable(provider='gemini', reason)`
**And** no product search query is made

---

### Requirement 10: Semantic Search HTTP Handler

The system MUST expose `POST /api/v1/products/semantic-search` as a new Lambda handler.

- Request body validated by a Zod schema: `{ q: string, limit?: number }`.
- JWT authentication is enforced (same pattern as other products endpoints: extract Bearer token, verify JWT).
- Calls `SemanticSearchUseCase.execute(input)` with validated and coerced input.
- Returns HTTP 200 with `{ items: Product[], total: number }` on success.
- On `InvalidSemanticSearchQuery`: returns HTTP 400 with `{ code: 'INVALID_SEMANTIC_SEARCH_QUERY', message }`.
- On `EmbeddingProviderUnavailable`: returns HTTP 503 with `{ code: 'EMBEDDING_PROVIDER_UNAVAILABLE', provider, retryAfter: 60 }`.
- Default `limit` is 10 if not provided; maximum is 50.

#### Scenario 10.1: 200 happy path

**Given** a valid JWT token and a request body `{ "q": "laptop gaming", "limit": 5 }`
**When** the handler is invoked
**Then** it returns HTTP 200
**And** the body is `{ "items": [...], "total": 5 }`

#### Scenario 10.2: 400 on invalid body

**Given** a valid JWT token and a request body `{ "q": "ab" }` (query too short)
**When** the handler is invoked
**Then** it returns HTTP 400
**And** the body contains `code: 'INVALID_SEMANTIC_SEARCH_QUERY'`

#### Scenario 10.3: 503 on embedding provider failure

**Given** a valid JWT token, a valid request body, and Gemini is unreachable
**When** the handler is invoked
**Then** it returns HTTP 503
**And** the body contains `code: 'EMBEDDING_PROVIDER_UNAVAILABLE'`
**And** the body contains `retryAfter: 60`

---

### Requirement 11: Bootstrap Wiring

The system MUST wire the `EmbeddingPort` into all affected use cases during the `bootstrapProducts()` cold-start.

- `bootstrapProducts()` is extended to:
  1. Resolve the API key (SSM in AWS, local env for `STAGE=local`).
  2. Build `EmbeddingPort` via `EmbeddingFactory` with `{ provider: env.EMBEDDING_PROVIDER, apiKey, ... }`.
  3. Pass the `embeddingPort` instance to `CreateProductUseCase`, `UpdateProductUseCase`, and `SemanticSearchUseCase`.
- All wiring happens once per cold start, memoized via `globalThis.__mercadoExpressProducts`.
- No new dependencies are introduced in domain or application code (only infrastructure imports the factory and the SDK).

#### Scenario 11.1: Cold start wires adapter once

**Given** the Lambda is in a cold-start state (no prior bootstrap)
**When** `bootstrapProducts()` is called
**Then** the SSM/API-key resolver is called
**And** `EmbeddingFactory.buildEmbeddingProvider` is called once
**And** the `embeddingPort` is passed to each use case constructor
**And** subsequent calls to `bootstrapProducts()` return the same instance without re-wiring

#### Scenario 11.2: Warm invocation reuses singleton

**Given** `bootstrapProducts()` has already been called (warm execution)
**When** `bootstrapProducts()` is called again
**Then** no SSM call is made
**And** no factory call is made
**And** the previously constructed `embeddingPort` instance is returned

---

### Requirement 12: Hexagonal Layer Discipline

The system MUST enforce that no AI SDK or environment variable access exists in the domain or application layers.

- A new architecture test file `packages/backend/test/architecture/embedding-layer-discipline.test.ts` MUST fail the build if violated.
- No file under `products/domain/` or `products/application/` imports any of:
  - `@google/generative-ai`
  - `@google-cloud/vertexai`
  - `openai`
  - `@anthropic-ai/sdk`
  - `voyageai`
  - `ollama`
- No file under `products/domain/` accesses `process.env` (env var reads are infrastructure concerns only).

#### Scenario 12.1: domain/ contains zero SDK imports

**Given** a file in `products/domain/` exists
**When** the architecture test scans all files under `products/domain/`
**Then** no file contains a require or import matching any blocked SDK package name

#### Scenario 12.2: application/ contains zero SDK imports

**Given** a file in `products/application/` exists
**When** the architecture test scans all files under `products/application/`
**Then** no file contains a require or import matching any blocked SDK package name

#### Scenario 12.3: domain/ contains zero process.env references

**Given** a file in `products/domain/` exists
**When** the architecture test scans all files under `products/domain/`
**Then** no file references `process.env` or `process.argv`

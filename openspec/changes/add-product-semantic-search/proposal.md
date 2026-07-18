# Proposal: Add Product Semantic Search (Google AI Studio Embeddings)

**Status:** Draft → review pending
**Change:** `add-product-semantic-search`
**Project:** ceiba_software
**Branch:** `feat/product-semantic-search`
**Phase:** sdd-propose → next: sdd-spec

---

## TL;DR

Add **semantic search** to the products BC so users can find products by meaning, not just exact keywords. Embeddings come from `gemini-embedding-001` (Google AI Studio, 768 dims), stored as a `vector(768)` column in Postgres via pgvector. Embeddings are computed **asynchronously** on create/update with a **fail-open** retry policy. Provider selection is driven entirely by `EMBEDDING_PROVIDER` env var (only `gemini` implemented in Phase 1). Domain layer never imports a concrete SDK.

---

## Problem statement

Today the products BC supports list/get/create/update only. A user trying to find "laptop para gaming barato" or "zapatos de cuero para dama" must rely on exact `ILIKE` matches against `name`, `description`, or `supplier`. This is brittle: typos, synonyms, and Spanish/English mixing defeat it. Catalog managers and end users repeatedly file UX complaints about "no encuentra lo que busco". The backend has the right data shape but lacks a meaning-based retrieval path.

## Desired outcome

After this change, a single new endpoint enables meaning-based product lookup:

- `POST /api/v1/products/semantic-search` with body `{ q: string, limit?: number }` returns products ordered by cosine similarity to the query embedding.
- Newly created or updated products get their embedding populated **in the background**, within seconds, with no extra API call from the client.
- If Gemini is unreachable, products still persist; the column stays `NULL` and a warning is logged. Search gracefully excludes those rows.
- Switching LLM providers is a **one-env-var + one-adapter-file** change — no domain or application edits.

---

## Why this approach

- **Port + adapter (`EmbeddingPort`)** keeps `domain/` and `application/` free of any vendor SDK. The factory in `infrastructure/` is the only place that knows about `@google/generative-ai`. This satisfies the "minimal code changes" constraint and future-proofs OpenAI/Ollama/Voyage adoption.
- **Async fire-and-forget** (via `setImmediate` / detached Promise) preserves create/update latency. Embedding is **derived state**, not part of the transactional write path. Failures must not roll back persistence.
- **Fail-open with exponential backoff (1s/2s/4s, 3 attempts)** mirrors the existing `alertOpener` best-effort pattern in `create-product.ts`. After exhaustion, the row stays `NULL` and a future re-embed job (backlog) can fill it.
- **pgvector HNSW index** on `embedding` keeps query latency flat at MVP scale (~3 MB for 1k products × 768 dims). Local Docker already provisions the extension via `docker/postgres-init/01-pgvector.sql`; RDS via the `default_extensions` parameter group.
- **SSM Parameter Store + `globalThis` cache** stores `GEMINI_API_KEY` as `SecureString` at `/ceiba/{stage}/gemini-api-key`. Local dev reads from `.env.dev`. The Lambda fetches once at cold start, then reuses for the execution environment lifetime. Same pattern already used for `jwt-secret` and `admin-password`.

---

## Scope (in)

- Backend only (no frontend, no shared package changes beyond a new error code if needed).
- Products BC only.
- New endpoint `POST /api/v1/products/semantic-search` (request `{ q, limit? }`, limit default 10, max 50).
- Auto-embedding on create + update (async, fire-and-forget, best-effort).
- Drizzle migration `packages/backend/drizzle/0001_add_product_embedding.sql`:
  - `ALTER TABLE products ADD COLUMN embedding vector(768);` (nullable, idempotent on re-run).
  - `CREATE INDEX products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops);`
- `EmbeddingPort` interface in `packages/backend/src/products/domain/ports/embedding.ts`.
- `GeminiEmbeddingAdapter` in `packages/backend/src/products/infrastructure/embedding/gemini-adapter.ts` (first concrete adapter).
- `EmbeddingFactory` in `products/infrastructure/embedding/factory.ts` selecting by `EMBEDDING_PROVIDER`.
- SSM parameter `/ceiba/{stage}/gemini-api-key` added in CDK (`DatabaseStack` or `ApiStack` per project pattern).
- CDK route addition for `POST /products/semantic-search` in `ApiStack.ts`.
- Vitest tests (unit + application with manual stubs + handler with `vi.mock`).
- One new handler `semantic-search.ts` registered in `lambda/handler.ts` `ROUTE_MAP`.
- One new use case `SemanticSearchUseCase` in `application/semantic-search-products.ts`.
- Documentation: `.env.dev.example` with `EMBEDDING_PROVIDER` and provider-specific keys.

## Out of scope (locked)

- **ChatPort / LLM port** — only embeddings in this change.
- **OpenAI, Ollama, Voyage adapters** — architecture supports them; **Phase 1 ships only Gemini**.
- **Re-embed of existing products** — backlog, manual trigger acceptable for Phase 1.
- **Frontend UI** — separate PR, depends on the endpoint contract.
- **Caching of embeddings** — pgvector is the storage; no Redis/in-memory cache layer.
- **Rate limiting specific to `/semantic-search`** — uses API Gateway default throttle.
- **Logging/tracing beyond standard pino** — no OpenTelemetry, no X-Ray subsegments.
- **NOT NULL constraint on `embedding`** — kept nullable for safe re-runs of the migration.
- **Cross-BC embedding reuse** — embeddings are scoped to the products BC only.
- **Synchronous embedding on write** — explicitly rejected to protect p99 latency.

---

## Acceptance scenarios (high-level Gherkin)

### Scenario 1 — Auto-embed on create

**Given** a valid `POST /api/v1/products` with `name="Laptop Gamer"`, `description="..."`, `supplier="ACME"`
**When** the request succeeds
**Then** the product is persisted (201)
**And** within 5 seconds the `embedding` column is populated with a 768-dim vector
**And** a search with `q="computadora para juegos"` returns the product in the top 5 results.

### Scenario 2 — Fail-open after 3 Gemini retries

**Given** the Gemini API returns 500 for all requests
**When** a product is created
**Then** the product is persisted (201)
**And** the `embedding` column stays `NULL`
**And** a warning is logged **without** the API key
**And** `semantic-search` excludes products with `NULL` embedding.

### Scenario 3 — Provider switch via `.env`

**Given** `EMBEDDING_PROVIDER=gemini` in `.env.dev`
**When** the Lambda boots
**Then** `GeminiEmbeddingAdapter` is constructed and wired as `EmbeddingPort`
**And** zero imports of `@google/generative-ai` exist in `domain/` or `application/` (enforced by `cross-bc-bounds.test.ts`-style check).

### Scenario 4 — Semantic search endpoint

**Given** 100 products exist with embeddings
**When** the client calls `POST /api/v1/products/semantic-search?q=zapatos de cuero`
**Then** results are ordered by cosine similarity descending
**And** `limit` defaults to 10 and is capped at 50
**And** products with `NULL` embedding are excluded
**And** the response is 200 with shape `{ items: Product[], total: number }`.

### Scenario 5 — SSM API key resolution

**Given** the Lambda is deployed to AWS dev stage
**When** it cold-starts
**Then** it fetches `/ceiba/dev/gemini-api-key` from SSM Parameter Store
**And** caches the value in `globalThis` for the execution environment lifetime
**And** no API key string appears in CloudWatch logs (verified by `pino` redaction).

### Scenario 6 — Switch LLMs by editing only `.env`

**Given** the project ships only the Gemini adapter
**When** a developer adds an `OpenAIEmbeddingAdapter` file
**And** updates `.env.example` with `EMBEDDING_PROVIDER=openai`
**And** sets `OPENAI_API_KEY`
**Then** no other code changes are needed (factory picks the new adapter)
**And** the existing test suite still passes (with stubs for the new adapter).

---

## Open questions for sdd-spec

1. **Text concatenation format** — single space vs. newline separator; cap on max chars before truncation to stay below Gemini's input limit.
2. **Long descriptions** — how to handle inputs >8192 tokens (Gemini input cap): truncate vs. chunk-and-average vs. reject.
3. **Concurrency limit for background embeddings** — Lambda can hit 1000 concurrent executions; do we throttle the fire-and-forget path?
4. **Drizzle `customType` for the 768-dim vector column** — confirm the exact API and casting strategy in repository queries.
5. **Auth scope for `/semantic-search`** — same JWT as create/update, or admin-only? (Recommendation: same as list/get.)
6. **pg-mem support for vector ops** — confirm via a 30-min PoC before relying on it for integration tests.
7. **What changes trigger re-embed** — only `name` / `description` / `supplier`, or also category rename? (Embeddings live on `products`, so category change does not affect them.)
8. **Telemetry** — do we want a CloudWatch metric for `embedding_attempts_total{outcome=success|retry|exhausted}`? Default: no, keep PR small.

---

## Risks (from `explore.md` §10)

| #   | Risk                                                | Severity | Mitigation                                                                                                                                |
| --- | --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lambda cold-start impact (Gemini client init)       | MEDIUM   | `globalThis` singleton keeps client warm between invocations; monitor cold-start latency in CloudWatch.                                   |
| 2   | pgvector index size                                 | LOW      | 768 dims × ~1k products ≈ 3 MB; HNSW acceptable for MVP scale.                                                                            |
| 3   | Drizzle `customType` for the 768-dim vector column  | MEDIUM   | Cast explicitly in repository queries; PoC before final migration is committed.                                                           |
| 4   | `.env` drift between local and AWS SSM              | HIGH     | `.env.dev.example` mirrors the SSM key naming convention `/ceiba/{stage}/gemini-api-key`; document the convention in the README addendum. |
| 5   | API key leakage in pino logs                        | MEDIUM   | Pino redaction config + adapter never logs request body or headers; audit before merge.                                                   |
| 6   | Migration idempotency                               | MEDIUM   | Nullable column only (no `NOT NULL`); no backfill in SQL; future re-embed job is an app-layer concern.                                    |
| 7   | Gemini API rate limits (relevant only for re-embed) | MEDIUM   | N/A in Phase 1 (no re-embed); future job must include batch delays + exponential backoff.                                                 |

---

## Constraints

- **AWS Free Tier** — Lambda + RDS t3.micro; SSM Parameter Store is free for standard params (no Secrets Manager usage).
- **Single PR delivery** — no chained PRs unless the design phase surfaces a >400-line authored footprint.
- **Strict TDD mode** — every new use case follows RED → GREEN → TRIANGULATE.
- **Vitest only** — no Jest, no new test framework.
- **UI is out of scope** — this PR ships the endpoint contract; frontend wiring lands separately.
- **Hexagonal layer discipline** — `cross-bc-bounds.test.ts` style guard must extend to forbid AI SDK imports in `domain/` and `application/`.

---

## Reference

- Full exploration (25 files, 10 sections): `openspec/changes/add-product-semantic-search/explore.md`
- Locked preflight decisions: Engram topic_key `sdd-add-product-semantic-search-final-preflight`
- Stack decisions (project baseline): Engram topic_key `sdd/mercadoexpress/stack-decisions`

---

**Next phase:** `sdd-spec` — translate this proposal into per-capability specs, resolve the open questions, and lock the domain/application interfaces.

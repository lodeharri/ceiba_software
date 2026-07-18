# Tasks: add-product-semantic-search

**Phase:** sdd-tasks
**Artifact store:** openspec
**Project:** ceiba_software
**Branch:** `feat/product-semantic-search`
**Strict TDD:** ACTIVE (Vitest) — every production task follows RED → GREEN → TRIANGULATE.
**Delivery strategy:** single PR with size exception (detail in Review Workload Forecast below).

---

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~800 authored (impl + tests + CDK + e2e). Profile breakdown: ~600 source, ~250 test, ~30 CDK, ~40 e2e/.env.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 400-line budget risk    | **High** — design.md Appendix A estimates ~880 authored LOC across 18 new + 10 modified files.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Chained PRs recommended | **Yes** — but user-locked single PR unless >400. **Request size exception OR a 2-slice split.**                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Suggested split         | PR slice 1 (Groups 1–4, 14.1): `feat(embedding): shared errors + EmbeddingPort + Drizzle migration + EmbeddingFactory wiring + SSM CDK param` (~350 LOC, vertical slice: error contract → port → schema → CDK foundation). PR slice 2 (Groups 5–15, 14.2–14.3): `feat(search): Gemini adapter + use cases + handler + bootstrap + CDK route + e2e` (~480 LOC, depends on slice 1). **Recommend single PR + size:exception over chaining** — same atomic delivery, fewer GitHub coordination points, slice 2 has no independent value without slice 1. |
| Delivery strategy       | **exception-ok** (ask for `size:exception` before apply in parent gate)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Chain strategy          | **pending** — resolution tied to whether parent grants size exception or asks for chained PRs                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Decision needed before apply: **Yes** — parent must confirm `size:exception` OR pivot to chained PRs (2 slices, stacked-to-main or feature-branch-chain). Tasks below are committed-as-one unless parent overrides.

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

---

## Task Ownership Legend

- `<!-- sdd-owner: implementation -->` — RED / GREEN / TRIANGULATE / REFACTOR work: code, tests, apply-owned verification. Consumed by `sdd-apply`.
- `<!-- sdd-owner: parent -->` — Explicit post-apply bounded-review and lifecycle-gate actions. Grouped separately after implementation work. NOT consumed by `sdd-apply`.

---

## Group 1: Shared foundation (errors, env, redaction)

> Goal: lock the new error contract before any layer can throw. All later layers import from these.

### Task 1.1: Add 3 error codes to the shared ErrorCode registry

**Layer**: shared (cross-package)
**Files**:

- NEW: `packages/backend/test/shared/error-codes.embedding.test.ts` (RED fixture)
- MODIFIED: `packages/shared/src/errors/errorCodes.ts` (add 3 codes)

**Spec reference**: Requirement 5 (error matrix, design.md §5)
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `packages/backend/test/shared/error-codes.embedding.test.ts` that imports `ErrorCode` from `@mercadoexpress/shared`, asserts the three string literals do NOT yet exist (test must fail).
2. GREEN: append `EMBEDDING_PROVIDER_UNAVAILABLE`, `EMBEDDING_INPUT_TOO_LONG`, `INVALID_SEMANTIC_SEARCH_QUERY` to the `ErrorCode` const object in `packages/shared/src/errors/errorCodes.ts`.
3. Run vitest; assert the test now passes and no other consumers break.

**Acceptance**:

- [ ] `pnpm --filter @mercadoexpress/shared type-check` clean <!-- sdd-owner: implementation -->
- [ ] `pnpm --filter @mercadoexpress/backend test test/shared/error-codes.embedding.test.ts` passes <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes this file) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep error code value === key (string literal identity) per convention; the existing `ErrorCodeValue` type alias picks them up automatically.

### Task 1.2: Add 3 domain error classes extending BaseDomainError

**Layer**: domain
**Files**:

- NEW: `packages/backend/src/products/domain/errors/embedding-provider-unavailable.ts`
- NEW: `packages/backend/src/products/domain/errors/embedding-input-too-long.ts`
- NEW: `packages/backend/src/products/domain/errors/invalid-semantic-search-query.ts`
- NEW: `packages/backend/src/products/domain/errors/embedding-errors.test.ts` (RED fixture covering constructor + httpStatus + details shape)

**Spec reference**: Requirement 5 (error matrix)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write `embedding-errors.test.ts` that imports each error class, asserts `instanceof BaseDomainError`, exact `code`, exact `httpStatus`, and carries the documented `details` payload. Test must fail because the files don't exist yet.
2. GREEN: implement three files (see design.md §5.1 for signatures):
   - `EmbeddingProviderUnavailableError(provider, reason)` → 503, code `EMBEDDING_PROVIDER_UNAVAILABLE`, `details: { provider, reason }`.
   - `EmbeddingInputTooLongError(length)` → 400, code `EMBEDDING_INPUT_TOO_LONG`, `details: { length }`.
   - `InvalidSemanticSearchQueryError(query)` → 400, code `INVALID_SEMANTIC_SEARCH_QUERY`, `details: { queryLength: query.length }`.
3. TRIANGULATE: add edge-case assertions — empty-string query yields `queryLength: 0`; provider `''` roundtrips as-is in details; super(`cause`) propagates when supplied.

**Acceptance**:

- [ ] all three error classes extend `BaseDomainError` <!-- sdd-owner: implementation -->
- [ ] HTTP status codes: 503 / 400 / 400 per error matrix <!-- sdd-owner: implementation -->
- [ ] details payloads match design.md §5.1 exactly <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `embedding-errors.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep files under 25 LOC each; no business logic — pure value carriers.

### Task 1.3: Wire the new error into the shared error mapper

**Layer**: shared (backend)
**Files**:

- NEW: `packages/backend/src/shared/error-mapper.embedding.test.ts` (RED fixture asserting 503 envelope + retryAfter in details)
- MODIFIED: `packages/backend/src/shared/error-mapper.ts` (add `EmbeddingProviderUnavailableError instanceof` branch)

**Spec reference**: Requirement 10 (503 on `EmbeddingProviderUnavailable`) + Requirement 5
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write `error-mapper.embedding.test.ts` that throws an `EmbeddingProviderUnavailableError('gemini','ssm-fetch-failed')` and asserts the resulting envelope has `statusCode: 503`, `code: 'EMBEDDING_PROVIDER_UNAVAILABLE'`, and `details.retryAfter === 60`. Test must fail (no branch in mapper yet).
2. GREEN: in `packages/backend/src/shared/error-mapper.ts`, import `EmbeddingProviderUnavailableError` and add a branch BEFORE the generic `BaseDomainError` fallback so it can override `details` to include `retryAfter: 60`. Keep the existing generic branch for the OTHER two new errors (they inherit the standard mapping).
3. TRIANGULATE: assert `toErrorResponse(thrown, ctx)` does not leak the original message for unknown throws (existing behavior preserved); add a focused assertion that the new branch returns 503 even when wrapped in another Error type (defensive — confirm via instanceof).

**Acceptance**:

- [ ] 503 envelope has `retryAfter: 60` in details (Requirement 10.3) <!-- sdd-owner: implementation -->
- [ ] existing error mapping branches unchanged (no regressions) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `error-mapper.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: do not fork the generic `BaseDomainError` branch — only the 503 case needs the extra `retryAfter` detail.

### Task 1.4: Update `.env.dev.example` and `.env.example` with embedding variables

**Layer**: infra (env)
**Files**:

- MODIFIED: `.env.dev.example` (add `EMBEDDING_PROVIDER`, `GEMINI_API_KEY`, `SSM_GEMINI_KEY_PATH`)
- MODIFIED: `.env.example` (same vars, values omitted/redacted)

**Spec reference**: Requirement 4 (SSM + local env) + Requirement 3 (factory env)
**TDD cycle**: none required (config file change; verification by infra smoke)

**Steps**:

1. Read each file to confirm current state.
2. Add (or merge) the following block — match exact indentation/comments used in the rest of the file:

   ```
   # Embedding provider selection (Phase 1: gemini only)
   EMBEDDING_PROVIDER=gemini
   # Gemini API key (local dev only — AWS uses SSM /ceiba/${STAGE}/gemini-api-key)
   GEMINI_API_KEY=
   ```

3. In `.env.dev.example` also include a working dev placeholder; in `.env.example` leave values blank for safety.

**Acceptance**:

- [ ] `.env.dev.example` includes `EMBEDDING_PROVIDER=gemini` and a comment explaining SSM mirroring <!-- sdd-owner: implementation -->
- [ ] `.env.example` includes the same keys with no values <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: no test required. The `STAGE` and `AWS_ENDPOINT_URL` semantics are documented in the comment so future developers don't bypass SSM in AWS accidentally.

### Task 1.5: Add pino redaction rules so API keys never reach CloudWatch

**Layer**: shared (backend/logger)
**Files**:

- NEW: `packages/backend/src/shared/logger.redaction.test.ts` (RED fixture proving keys are redacted in JSON output)
- MODIFIED: `packages/backend/src/shared/logger.ts` (extend `createLogger()` with `redact` paths for apiKey variants)

**Spec reference**: Requirement 2 (`apiKey` MUST NOT appear in any log) + Requirement 4 (Scenario 4.4)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write `logger.redaction.test.ts` that creates a logger via `createLogger()`, calls `.info({ apiKey: 'sk-gemini-secret-xyz', nested: { GEMINI_API_KEY: 'sk-gemini-other' } })`, captures the JSON line via a writable stream or `pino`'s test-friendly target, and asserts the substring `sk-gemini-secret-xyz` does NOT appear while the key names remain. Test must fail.
2. GREEN: add `redact: ['*.apiKey', '*.GEMINI_API_KEY', '*.gemini_api_key', 'apiKey', 'GEMINI_API_KEY']` to the `pino({...})` options in `createLogger()`.
3. TRIANGULATE: add assertions for deeply nested keys (`context.embedder.apiKey`) and for non-sensitive siblings (regular fields unaffected).

**Acceptance**:

- [ ] Redaction paths cover flat and one-level nested `apiKey` / `GEMINI_API_KEY` keys (Scenario 4.4 + Requirement 2.6) <!-- sdd-owner: implementation -->
- [ ] Existing logger consumers unaffected (no log line shape regressions) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `logger.redaction.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep redact paths as conservative over-matches; better to redact too much than to leak the key. The adapter tests in Group 6 additionally assert no log call carries the API key string.

---

## Group 2: Domain port + interface

> Goal: define the `EmbeddingPort` abstraction so domain/application layers depend on a pure interface.

### Task 2.1: Create the `EmbeddingPort` interface in domain/ports

**Layer**: domain
**Files**:

- NEW: `packages/backend/src/products/domain/ports/embedding.ts`
- NEW: `packages/backend/src/products/domain/ports/embedding.test.ts` (compile-time + runtime shape verification — RED fixture uses a manual stub)

**Spec reference**: Requirement 1 (EmbeddingPort contract)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write `embedding.test.ts` that defines a manual stub `const stub: EmbeddingPort = { embed: vi.fn(), embedBatch: vi.fn() }` and asserts:
   - `embed('x')` returns a Promise of length 768 (stub returns `Array(768).fill(0.1)`).
   - `embedBatch(['a','b'])` returns a 2-element array of length-768 sub-arrays in order.
   - Both return types are `readonly` (verified via `Object.freeze` not required, but `as const` array check).
   - Test FAILS because the module does not yet export `EmbeddingPort`.
2. GREEN: create `packages/backend/src/products/domain/ports/embedding.ts` exporting the interface exactly as the spec requires: `{ embed(text: string): Promise<readonly number[]>; embedBatch(texts: string[]): Promise<readonly (readonly number[])[]> }`.
3. TRIANGULATE: add Scenario 1.2 order-preservation test (multi-input ordering) and assert dimension invariant (length 768) for both methods. No real implementation, no SDK, no env access (Requirement 12.1, 12.3 covered by Group 13).

**Acceptance**:

- [ ] Interface matches design.md §3 R1 verbatim (no SDK import, no `process.env`) <!-- sdd-owner: implementation -->
- [ ] All three scenarios from Requirement 1 are covered by the test file <!-- sdd-owner: implementation -->
- [ ] Return types use `readonly` (defensive, prevents downstream mutation) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `embedding.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: this file is consumed by every other group — domain/, application/, infrastructure/. Once committed, downstream tasks can typecheck against it.

---

## Group 3: Database (Drizzle migration + schema)

> Goal: add the `embedding vector(768)` column + HNSW index. Migration MUST be idempotent. Schema regenerates cleanly.

### Task 3.1: Write the idempotent SQL migration

**Layer**: infrastructure (DB)
**Files**:

- NEW: `packages/backend/drizzle/0001_add_product_embedding.sql` (idempotent ALTER + CREATE INDEX)
- NEW: `packages/backend/drizzle/0001.idempotency.test.ts` (integration: real pgvector Postgres via `DATABASE_URL`)

**Spec reference**: Requirement 5 (Drizzle migration)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write an integration test `0001.idempotency.test.ts` that:
   - Skips if `process.env.DATABASE_URL` is unset (so CI without DB still passes).
   - Applies the migration SQL once against a temp schema, asserts `embedding` column exists and `products_embedding_hnsw` index exists with `USING hnsw`.
   - Replays the SQL — asserts NO error (idempotent).
   - Inserts a row with NULL embedding and one with a 768-dim array.
   - Test FAILS because the SQL file does not exist yet.
2. GREEN: create `0001_add_product_embedding.sql` containing exactly (as in design.md §3 R5):

   ```sql
   ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(768);
   CREATE INDEX IF NOT EXISTS products_embedding_hnsw
     ON products USING hnsw (embedding vector_cosine_ops);
   ```

   No `CREATE EXTENSION` (pre-enabled via Docker init / RDS parameter group).

3. TRIANGULATE: add a third assertion — `SELECT indexdef FROM pg_indexes WHERE indexname='products_embedding_hnsw'` contains `USING hnsw (embedding vector_cosine_ops)`.

**Acceptance**:

- [ ] Migration runs cleanly on a fresh database (column + index created) <!-- sdd-owner: implementation -->
- [ ] Migration is idempotent — replay does not throw <!-- sdd-owner: implementation -->
- [ ] `products.embedding` accepts NULL <!-- sdd-owner: implementation -->
- [ ] `products.embedding` accepts a 768-dim numeric array <!-- sdd-owner: implementation -->
- [ ] HNSW index uses `vector_cosine_ops` operator class <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `0001.idempotency.test.ts` when `DATABASE_URL` set) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: integration test gated by `DATABASE_URL` to keep CI hermetic for non-DB jobs. `docker/postgres-init/01-pgvector.sql` already provisions the extension.

### Task 3.2: Add `vector` customType helper and extend the `products` schema

**Layer**: infrastructure (DB / Drizzle)
**Files**:

- MODIFIED: `packages/backend/src/db/schema.ts` (add `vector` customType + `embedding` column on `products`)
- NEW: `packages/backend/src/db/schema.embedding.test.ts` (type-level + drizzle-kit introspection test)

**Spec reference**: Requirement 5 (Drizzle schema with customType) + Requirement 12 (no `process.env` access — N/A here)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write `schema.embedding.test.ts` that imports `products` from `schema.ts` and asserts the column exists with `pgColumn` metadata named `embedding`, plus that the inferred row type includes `embedding: number[] | null`. Test FAILS because the column is absent.
2. GREEN: in `packages/backend/src/db/schema.ts`:
   - Near the existing `customType` import (already present from `idempotency_keys`), add `const vector = customType<{ data: number[] }>({ dataType: () => 'vector(768)' });`.
   - On `pgTable('products', { ... })`, add `embedding: vector('embedding'),` (no `.notNull()`, no `.default()`).
3. TRIANGULATE: assert `drizzle-kit generate` (if run as part of vitest setup) does NOT regenerate `0000_initial.sql` — i.e. the new column changes are captured ONLY in the new migration. Run `pnpm --filter @mercadoexpress/backend db:migrate` against the temp DB and confirm Drizzle considers the schema applied.

**Acceptance**:

- [ ] `embedding` column appears in inferred row type as nullable `number[]` <!-- sdd-owner: implementation -->
- [ ] `drizzle-kit generate` does not regenerate `0000_initial.sql` (diff is empty for 0000) <!-- sdd-owner: implementation -->
- [ ] Existing schema consumers (`DrizzleProductRepository`, `DrizzleAlertOpenerPort`, etc.) still type-check <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `schema.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: do NOT default the column to `[]` — embedding must remain nullable until the fire-and-forget completes. Do NOT add `.notNull()`.

### Task 3.3: Update the Drizzle journal to register the new migration

**Layer**: infrastructure (DB / Drizzle config)
**Files**:

- MODIFIED: `packages/backend/drizzle/meta/_journal.json` (append entry for `0001_add_product_embedding`)

**Spec reference**: Requirement 5 (migration applied by `drizzle-kit migrate` in CI)
**TDD cycle**: none (config file; verification by `drizzle-kit migrate` succeeding against a real DB)

**Steps**:

1. Append a new entry to the `entries` array AFTER `0000_initial`:

   ```json
   { "idx": 1, "version": "7", "when": <unix-ms-timestamp-at-commit-time>, "tag": "0001_add_product_embedding", "breakpoints": true }
   ```

2. Run `pnpm --filter @mercadoexpress/backend db:migrate` against a clean local Postgres; confirm it applies both 0000 and 0001 in order.
3. Re-run `db:migrate`; confirm idempotency (no-op on second run).

**Acceptance**:

- [ ] `_journal.json` is valid JSON <!-- sdd-owner: implementation -->
- [ ] `drizzle-kit migrate` applies the new SQL on a clean DB <!-- sdd-owner: implementation -->
- [ ] Re-running `drizzle-kit migrate` is a no-op <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep the `version: "7"` to match the existing entry — Drizzle 0.x migrator is strict about schema version compatibility.

---

## Group 4: Repository extension (port + Drizzle adapter)

> Goal: extend the products repository with `findByEmbedding` (similarity search) + `updateEmbedding` (background path writes).

### Task 4.1: Extend the `ProductRepository` port with embedding methods

**Layer**: domain
**Files**:

- MODIFIED: `packages/backend/src/products/domain/ports/product-repository.ts` (add `findByEmbedding` + `updateEmbedding`)
- NEW: `packages/backend/src/products/domain/ports/product-repository.embedding.test.ts` (interface conformance — manual stub assertions)

**Spec reference**: Requirement 6 (findByEmbedding contract) + Requirement 7 (updateEmbedding for background write)
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write a test file asserting the interface includes `findByEmbedding(embedding: number[], opts: { limit: number; minSimilarity?: number }): Promise<ProductProps[]>` and `updateEmbedding(id: string, embedding: number[]): Promise<void>`. Test must FAIL because the interface lacks these members.
2. GREEN: add the two methods to the `ProductRepository` interface (keep the existing `update` signature intact — `updateEmbedding` is a new method, not a union with `update`).
3. Re-run all existing application tests — they use manual stubs that DO NOT implement the new methods yet and WILL break. Update each stub in `products/application/*.test.ts` and any handler test stubs that implement `ProductRepository` to include `findByEmbedding: vi.fn(async () => [])` and `updateEmbedding: vi.fn(async () => undefined)`. This keeps the existing test suite green after the port extension.

**Acceptance**:

- [ ] Interface includes the two new methods with the exact signatures from design.md §3 R6 <!-- sdd-owner: implementation -->
- [ ] All existing application/handler test stubs updated to include the new methods (no `TypeError: ...is not a function`) <!-- sdd-owner: implementation -->
- [ ] `pnpm --filter @mercadoexpress/backend test` is GREEN end-to-end after port extension <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: update existing tests IN THE SAME COMMIT as the interface extension — keeping tests and code in one commit per the work-unit-commits skill.

### Task 4.2: Implement `findByEmbedding` + `updateEmbedding` in `DrizzleProductRepository`

**Layer**: infrastructure (Drizzle)
**Files**:

- MODIFIED: `packages/backend/src/products/infrastructure/drizzle-product-repository.ts`
- NEW: `packages/backend/src/products/infrastructure/drizzle-product-repository.embedding.test.ts` (unit stub test + integration test against real pgvector)

**Spec reference**: Requirement 6 (all 4 scenarios)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write unit assertions against a fake `db` (object with `.select/.update` mocks) covering:
   - `findByEmbedding(v, { limit: 200 })` clamps to `LIMIT 50`.
   - `findByEmbedding(v, { limit: 5 })` passes `LIMIT 5` through.
   - SQL filter `embedding IS NOT NULL` is in the WHERE clause.
   - `ORDER BY embedding <=> $1::vector` is in the ORDER BY clause.
   - `updateEmbedding(id, vec)` issues an UPDATE with the vector cast.
   - No DB call is made for `minSimilarity: 0` (default).
   - Test FAILS because the methods don't exist.
2. GREEN: implement both methods. Use `sql` template tag from `drizzle-orm` for the operator + cast. Clamp `limit` to `[1, 50]`. Keep `mapRowToProps`/`toProps` consistent with existing code.
3. TRIANGULATE: write the integration test (gated by `DATABASE_URL`):
   - Insert 3 products with known 768-dim embeddings (P1 most similar to query, P3 second, P2 last).
   - Call `findByEmbedding(queryVec, { limit: 10 })`.
   - Assert order matches cosine distance ascending.
   - Insert 2 more products with `embedding: null`.
   - Re-call; assert the 2 NULLs are excluded.
   - Call with `limit: 200`; assert at most 50 rows.

**Acceptance**:

- [ ] All 4 scenarios from Requirement 6 are covered in unit + integration tests <!-- sdd-owner: implementation -->
- [ ] `findByEmbedding` excludes NULL embeddings (Scenario 6.2) <!-- sdd-owner: implementation -->
- [ ] `limit` is clamped to `[1, 50]` (Scenario 6.3) <!-- sdd-owner: implementation -->
- [ ] `minSimilarity` is converted to `distance <= (1 - minSimilarity)` (Scenario 6.4) <!-- sdd-owner: implementation -->
- [ ] `updateEmbedding` writes the vector in a single UPDATE <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `drizzle-product-repository.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: do NOT use `pg-mem` for the integration test — pg-mem doesn't support vector ops. Use a real pgvector Postgres (Docker or CI DB). Keep the unit stub test as the day-to-day fast feedback.

---

## Group 5: Infrastructure — SSM/local API key resolver

> Goal: resolve `GEMINI_API_KEY` from AWS SSM Parameter Store in production, or directly from `process.env` for `STAGE=local`. Cache per cold start via `globalThis`.

### Task 5.1: Create `resolveGeminiApiKey` with cache + local fallback

**Layer**: infrastructure (AWS / SSM)
**Files**:

- NEW: `packages/backend/src/products/infrastructure/embedding/api-key-resolver.ts`
- NEW: `packages/backend/src/products/infrastructure/embedding/api-key-resolver.test.ts` (RED fixture: vi.mock `@aws-sdk/client-ssm`, assert cache + local + error paths)

**Spec reference**: Requirement 4 (all 4 scenarios)
**TDD cycle**: RED → GREEN → TRIANGULATE

**Steps**:

1. RED: write `api-key-resolver.test.ts` with three test blocks:
   - Mock `SSMClient` via `vi.mock('@aws-sdk/client-ssm')`; on first `resolveGeminiApiKey(logger)` assert `SSMClient.send` called once and returns `'sk-test-key'`; on second call assert `send` is NOT called again (cache hit).
   - Set `STAGE=local` and `GEMINI_API_KEY=sk-local` in env; assert `resolveGeminiApiKey` returns `'sk-local'` and NO `SSMClient.send` call is made.
   - Mock `SSMClient.send` to throw; assert `resolveGeminiApiKey` throws `EmbeddingProviderUnavailableError('gemini','ssm-fetch-failed')`.
   - All three test blocks must FAIL because the module doesn't exist.
2. GREEN: implement `resolveGeminiApiKey(logger)` per design.md §3 R4:
   - Compute `IS_LOCAL = STAGE === 'local' || !AWS_ENDPOINT_URL`.
   - Local path → return `process.env.GEMINI_API_KEY` (throw `EmbeddingProviderUnavailableError('gemini','missing-api-key')` if unset).
   - Cache path → check `globalThis.__ceibaEmbeddingApiKeyCache[stage]`.
   - SSM path → `new GetParametersCommand({ Names: [paramName], WithDecryption: true })`, resolve through the cached `SSMClient`, throw `ssm-fetch-failed` on any error, throw `ssm-param-not-found` if `result.Parameters?.[0].Value` is missing.
   - Implement the cache population after successful SSM fetch.
3. TRIANGULATE: add Scenario 4.4 — assert captured log output for both paths contains NO occurrence of the API key string. Also assert that `STAGE` change between two calls invalidates the cache.

**Acceptance**:

- [ ] All 4 scenarios from Requirement 4 covered (cache hit / cache miss / SSM error / local stage) <!-- sdd-owner: implementation -->
- [ ] API key value NEVER appears in any log line (Scenario 4.4) <!-- sdd-owner: implementation -->
- [ ] Cache invalidates when `STAGE` changes (defensive) <!-- sdd-owner: implementation -->
- [ ] SSM errors are wrapped in `EmbeddingProviderUnavailableError('gemini','ssm-fetch-failed')` <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `api-key-resolver.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: `SSMClient` module-level singleton keeps the connection warm between Lambda invocations (Lambda execution-environment reuse). Document this trade-off in the file header.

### Task 5.2: Add `@aws-sdk/client-ssm` to backend dependencies

**Layer**: infra (dependency)
**Files**:

- MODIFIED: `packages/backend/package.json` (add `@aws-sdk/client-ssm` to `dependencies`)

**Spec reference**: Requirement 4 (resolver uses `@aws-sdk/client-ssm`)
**TDD cycle**: none (dependency wiring — verification is `pnpm install` succeeding + the resolver's import resolving)

**Steps**:

1. Run `pnpm --filter @mercadoexpress/backend add @aws-sdk/client-ssm@latest` (use a recent stable version, not a canary).
2. Verify `pnpm install` resolves without peer-dep warnings.
3. Verify the import in `api-key-resolver.ts` resolves at `tsc --noEmit` time.

**Acceptance**:

- [ ] `@aws-sdk/client-ssm` appears under `dependencies` (NOT `devDependencies`) in `packages/backend/package.json` <!-- sdd-owner: implementation -->
- [ ] `pnpm --filter @mercadoexpress/backend type-check` succeeds (SSM imports resolve) <!-- sdd-owner: implementation -->
- [ ] `pnpm install` succeeds in monorepo root <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep the SDK version aligned with what is already used elsewhere in the monorepo (if present) to avoid duplicate copies.

---

## Group 6: Infrastructure — Gemini adapter (concrete `EmbeddingPort`)

> Goal: implement the first concrete `EmbeddingPort` against the Gemini HTTP API. Includes 3-attempt retry with exponential backoff (1s/2s/4s), 8192-char input cap, and pino redaction.

### Task 6.1: Create the `GeminiEmbeddingAdapter` skeleton (constructor + happy path)

**Layer**: infrastructure (HTTP client)
**Files**:

- NEW: `packages/backend/src/products/infrastructure/embedding/gemini-adapter.ts`
- NEW: `packages/backend/src/products/infrastructure/embedding/gemini-adapter.test.ts` (RED: inject fake `httpClient`)

**Spec reference**: Requirement 2 (Scenarios 2.1, 2.5 — happy path + input cap)
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `gemini-adapter.test.ts` that:
   - Constructs `new GeminiEmbeddingAdapter({ apiKey: 'sk-test', httpClient: fakeFetch, logger: stubLogger })`.
   - Stubs `fakeFetch` to return `{ ok: true, status: 200, json: async () => ({ embedding: { values: Array(768).fill(0.1) } }) }`.
   - Calls `embed('test')` and asserts the result has length 768 and the `fakeFetch` was called once with `?key=sk-test&...` and body containing `content.parts[0].text='test'`.
   - Calls `embed(longString)` for a 8193-char input and asserts `EmbeddingInputTooLongError` is thrown AND `fakeFetch` was called zero times.
   - Test FAILS because the module doesn't exist.
2. GREEN: implement the constructor + `embed()` method per design.md §3 R2. Constants `GEMINI_EMBEDDING_URL`, `MAX_INPUT_CHARS=8192`, `RETRY_DELAYS_MS=[1000,2000,4000]`. `withRetry` can be a TODO throw (`throw new Error('not yet implemented')`) for now — wired up in Task 6.2.
3. Verify cap: assert 8192-char input is allowed (boundary), 8193-char input throws.

**Acceptance**:

- [ ] `embed(text)` returns a `readonly number[]` of length 768 on success <!-- sdd-owner: implementation -->
- [ ] 8192-char input is the maximum allowed (no HTTP call made) <!-- sdd-owner: implementation -->
- [ ] 8193-char input throws `EmbeddingInputTooLongError` with the length in `details` <!-- sdd-owner: implementation -->
- [ ] `httpClient` is injectable (default to `globalThis.fetch`) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `gemini-adapter.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep `withRetry` skeletoned for Task 6.2 to keep this commit focused on the happy path + cap.

### Task 6.2: Implement `withRetry<T>` with exponential backoff and pino logging

**Layer**: infrastructure (HTTP client / retry)
**Files**:

- MODIFIED: `packages/backend/src/products/infrastructure/embedding/gemini-adapter.ts` (add private `withRetry`)
- MODIFIED: `packages/backend/src/products/infrastructure/embedding/gemini-adapter.test.ts` (extend with retry + exhaustion tests)

**Spec reference**: Requirement 2 (Scenarios 2.3, 2.4 — retry + exhaustion)
**TDD cycle**: GREEN → TRIANGULATE (RED was Task 6.1; this task wires the logic in)

**Steps**:

1. Implement `withRetry<T>(fn: () => Promise<T>): Promise<T>` per design.md §3 R2:
   - Loop `attempt = 1..4` (initial + 3 retries).
   - Catch any throw; on retryable attempt, log warn with `{provider, attempt, latencyMs, outcome:'retry', reason}` and `await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt-2]))`.
   - On final attempt (4th), log warn with `outcome: 'exhausted'` and rethrow.
   - On success (any attempt), log info `{outcome:'success', attempt, latencyMs}` and return.
2. Call `withRetry(() => this.callGemini(text))` from `embed()`.
3. TRIANGULATE: extend tests with:
   - Scenario 2.3: first call returns 429, second returns 200 → exact 2 calls, 1 retry log, vector returned.
   - Scenario 2.4: 3 consecutive 500s → exact 3 calls, `EmbeddingProviderUnavailableError('gemini','HTTP 500')` thrown.
   - Use `vi.useFakeTimers()` and `vi.runAllTimersAsync()` to avoid waiting real 1s/2s/4s.
   - Verify log calls include `outcome` discriminating.

**Acceptance**:

- [ ] Total attempts are at most 4 (initial + 3 retries) <!-- sdd-owner: implementation -->
- [ ] Delays between attempts: 1s / 2s / 4s in order <!-- sdd-owner: implementation -->
- [ ] After 3 retries exhausted → `EmbeddingProviderUnavailableError('gemini', <reason>)` thrown <!-- sdd-owner: implementation -->
- [ ] Retry happens on HTTP non-ok responses (Scenario 2.3) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `gemini-adapter.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: the `apiKey` value MUST NOT appear in any log call — covered by Task 6.3 triangulation but verify here too.

### Task 6.3: TRIANGULATE — API-key redaction, embedBatch parallel fan-out, and a full input-cap boundary

**Layer**: infrastructure (HTTP client / hardening)
**Files**:

- MODIFIED: `packages/backend/src/products/infrastructure/embedding/gemini-adapter.test.ts` (add 8192-boundary, batch, and redaction assertions)

**Spec reference**: Requirement 2 (Scenarios 2.2, 2.6)
**TDD cycle**: TRIANGULATE only

**Steps**:

1. Add `embedBatch(['a','b','c'])` test (Scenario 2.2): assert 3 calls to `fakeFetch` are made (parallel via `Promise.all`), each returns length 768, results in input order.
2. Add Scenario 2.6 (API key never logged):
   - Spy on `logger.info` and `logger.warn`.
   - Construct with `apiKey: 'sk-gemini-secret-xyz'`.
   - Call `embed('test')` — assert every captured log call has no argument that stringifies to contain `'sk-gemini-secret-xyz'`.
   - Force a failure path — call `embed('test')` with `fakeFetch` returning 500 3x; assert NO captured log call contains the API key.
3. Add 8192-boundary tests: input exactly 8192 chars returns success (allowed); input 8193 throws.

**Acceptance**:

- [ ] `embedBatch(['a','b','c'])` fans out in parallel (assert 3 concurrent calls by checking call timestamps) <!-- sdd-owner: implementation -->
- [ ] API key never appears in any log call across success AND failure paths (Scenario 2.6) <!-- sdd-owner: implementation -->
- [ ] Boundary 8192/8193 tests pass <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `gemini-adapter.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: if the redaction test fails, return to Task 1.5 and broaden the redact paths.

---

## Group 7: Infrastructure — EmbeddingFactory (singleton, provider switch)

> Goal: select the correct adapter based on `EMBEDDING_PROVIDER`; memoize the singleton per provider; fail-closed on unknown providers.

### Task 7.1: Create `buildEmbeddingProvider` with module-level memoization

**Layer**: infrastructure (factory)
**Files**:

- NEW: `packages/backend/src/products/infrastructure/embedding/factory.ts`
- NEW: `packages/backend/src/products/infrastructure/embedding/factory.test.ts` (RED: singleton + unknown provider + missing key)

**Spec reference**: Requirement 3 (Scenarios 3.2, 3.3, 3.4)
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `factory.test.ts` with:
   - Reset the module-level cache via `vi.resetModules()` between tests.
   - Call `buildEmbeddingProvider({ provider: 'unknown', apiKey: 'x', logger })` → assert `EmbeddingProviderUnavailableError('unknown-provider','unknown-provider')` thrown.
   - Call `buildEmbeddingProvider({ provider: 'gemini', logger })` (no apiKey) → assert `EmbeddingProviderUnavailableError('gemini','missing-api-key')` thrown.
   - Test FAILS because the module doesn't exist.
2. GREEN: implement per design.md §3 R3. Use a module-level `const cache = new Map<string, EmbeddingPort>()`. The `gemini` branch instantiates `GeminiEmbeddingAdapter` and caches. The default branch throws. Export `__resetFactoryCacheForTests()` to support deterministic tests.
3. TRIANGULATE (will be 7.2): assert singleton behavior in next task.

**Acceptance**:

- [x] Unknown provider throws at construction time (Scenario 3.2) <!-- sdd-owner: implementation -->
- [x] `gemini` without apiKey throws with reason `'missing-api-key'` (Scenario 3.3) <!-- sdd-owner: implementation -->
- [x] all tests pass (vitest run includes `factory.test.ts`) <!-- sdd-owner: implementation -->
- [x] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [x] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: factory cache survives across imports due to module evaluation semantics — tests must `vi.resetModules()` between cases for isolation.

### Task 7.2: TRIANGULATE — singleton on repeat calls (Scenario 3.1 + 3.4)

**Layer**: infrastructure (factory)
**Files**:

- MODIFIED: `packages/backend/src/products/infrastructure/embedding/factory.test.ts` (extend with Scenario 3.1 + 3.4)

**Spec reference**: Requirement 3 (Scenarios 3.1, 3.4)
**TDD cycle**: TRIANGULATE only

**Steps**:

1. Add Scenario 3.1: call `buildEmbeddingProvider({ provider: 'gemini', apiKey: 'sk-test', logger, httpClient: fakeFetch })` and assert the returned object implements `EmbeddingPort` (`embed` is a function). Spy on the `GeminiEmbeddingAdapter` constructor via `vi.spyOn` to assert it was called exactly once across BOTH the singleton assertion AND Scenario 3.4 below.
2. Add Scenario 3.4: call `buildEmbeddingProvider({ provider: 'gemini', apiKey: 'sk-test', ... })` twice and assert `result1 === result2` (strict equality). Use `__resetFactoryCacheForTests()` between unrelated test blocks.
3. Add a circuit check: after the singleton is cached, assert the map has exactly one key.

**Acceptance**:

- [x] First call with `provider: 'gemini'` returns a working `EmbeddingPort` (Scenario 3.1) <!-- sdd-owner: implementation -->
- [x] Second call with the same provider returns the IDENTICAL object reference (Scenario 3.4) <!-- sdd-owner: implementation -->
- [x] `GeminiEmbeddingAdapter` constructor is called exactly once for repeat calls <!-- sdd-owner: implementation -->
- [x] all tests pass (vitest run includes `factory.test.ts`) <!-- sdd-owner: implementation -->
- [x] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [x] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: if you ever need to disable the cache (e.g. for rotating keys across cold starts), the test reset helper is intentional.

---

## Group 8: Application — Create integration (fire-and-forget embed)

> Goal: after a product is created, kick off `embedInBackground` via `setImmediate`. Failures must NOT bubble up to the HTTP response.

### Task 8.1: Add optional `EmbeddingPort` injection to `CreateProductUseCase`

**Layer**: application
**Files**:

- MODIFIED: `packages/backend/src/products/application/create-product.ts`
- NEW: `packages/backend/src/products/application/create-product.embedding.test.ts` (RED: stub `EmbeddingPort`, assert `setImmediate` was invoked)

**Spec reference**: Requirement 7 (Scenario 7.1 — embed is invoked)
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `create-product.embedding.test.ts`:
   - Stub `EmbeddingPort` with `embed: vi.fn().mockResolvedValue(Array(768).fill(0.1))`.
   - Spy on `globalThis.setImmediate` (or use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`).
   - Construct `CreateProductUseCase(products, categories, alertOpener, stubEmbedder)`.
   - Call `useCase.execute(VALID_INPUT)` and await the resulting setImmediate microtasks.
   - Assert `stubEmbedder.embed` was called exactly once with the concatenated text `'Agua Mineral 500ml  Distribuidora Andina'` (note the double space — `description` is undefined in `VALID_INPUT`).
   - Test FAILS because the constructor does not accept a 4th argument.
2. GREEN: extend the constructor to accept a 4th parameter `embedder?: EmbeddingPort`. Inside `execute()`, AFTER `products.create()` resolves, if `this.embedder` is defined:
   - `const product = Product.rehydrate(persisted);`
   - `setImmediate(() => { void embedInBackground(product, this.embedder, this.products, logger); });`
     Define `embedInBackground` as a private helper (does the try/catch + log warn — implemented in Task 8.2 stub for now).
3. Refactor: keep `Product.rehydrate(persisted)` used in the existing return path; no behavior change for callers that don't inject an embedder.

**Acceptance**:

- [x] Constructor accepts optional `embedder` (existing 3-arg call sites still compile and pass) <!-- sdd-owner: implementation -->
- [x] `setImmediate` fires once with `embedInBackground(product, embedder, repo, logger)` when embedder is injected <!-- sdd-owner: implementation -->
- [x] Existing test (`create-product.test.ts`) still passes unchanged <!-- sdd-owner: implementation -->
- [x] all tests pass (vitest run includes `create-product.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [x] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [x] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: returning the SAME `Product` instance AFTER firing `setImmediate` preserves the existing fast-return pattern — the embedding happens off the response path.

### Task 8.2: Implement `embedInBackground` — try/catch + log warn + `updateEmbedding` call

**Layer**: application
**Files**:

- MODIFIED: `packages/backend/src/products/application/create-product.ts` (fill in `embedInBackground`)
- MODIFIED: `packages/backend/src/products/application/create-product.embedding.test.ts` (extend with Scenario 7.2: all retries fail)

**Spec reference**: Requirement 7 (all 3 scenarios)
**TDD cycle**: GREEN → TRIANGULATE

**Steps**:

1. Implement `embedInBackground(product, embedder, repo, log)`:
   - `const text =`${product.name} ${product.description ?? ''} ${product.supplier}`.trim();`
   - `try { const vector = await embedder.embed(text); await repo.updateEmbedding(product.id, [...vector]); }`
   - `catch (err) { log.warn({ productId: product.id, provider: 'gemini', outcome: 'exhausted', reason: err instanceof Error ? err.message : String(err) }, 'Embedding computation failed after retries; embedding remains NULL'); }`
   - NO throw. NO setImmediate inside (we are already in the setImmediate callback).
2. Re-run `create-product.embedding.test.ts` happy-path (Scenario 7.1) — `repo.updateEmbedding` called with the spread vector.
3. TRIANGULATE — Scenario 7.2:
   - Stub `embeddingPort.embed` to always reject with `EmbeddingProviderUnavailableError('gemini','HTTP 500')`.
   - Call `useCase.execute(VALID_INPUT)`; assert it RESOLVES (no rethrow).
   - Assert `repo.updateEmbedding` was NOT called.
   - Assert the captured log call contains `outcome: 'exhausted'` and NO occurrence of the original apiKey string (defensive cross-check).

**Acceptance**:

- [x] Scenario 7.1: after `execute()`, `repo.updateEmbedding(id, vector)` is called once <!-- sdd-owner: implementation -->
- [x] Scenario 7.2: `execute()` RESOLVES even when embedder throws; `updateEmbedding` NOT called; warning log captured <!-- sdd-owner: implementation -->
- [x] No throw bubbles out of `embedInBackground` (Requirement 7 fail-open contract) <!-- sdd-owner: implementation -->
- [x] all tests pass (vitest run includes `create-product.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [x] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [x] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: do not `await` the `setImmediate` callback from inside `execute()` — that would re-introduce the latency we are trying to avoid (Requirement 7.3).

---

## Group 9: Application — Update integration (text-field-only re-embed)

> Goal: re-embed ONLY when the update input includes `name`, `description`, or `supplier`. Stock/price-only updates MUST NOT trigger embedding.

### Task 9.1: Add optional embedder injection + text-field detection in `UpdateProductUseCase`

**Layer**: application
**Files**:

- MODIFIED: `packages/backend/src/products/application/update-product.ts`
- NEW: `packages/backend/src/products/application/update-product.embedding.test.ts` (RED: stub spy)

**Spec reference**: Requirement 8
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `update-product.embedding.test.ts` with:
   - `textFieldChange` test: stub repos + `embeddingPort`, spy on `setImmediate` (or use `vi.useFakeTimers()` + assertion that an immediate callback was scheduled). Call `execute(id, { name: 'New Name' })`. Assert `setImmediate` was called.
   - `stockOnlyChange` test: same setup, call `execute(id, { stock: 150 })`. Assert `setImmediate` was NOT called.
   - `noEmbedder` test: omit `embedder` from constructor, call `execute(id, { name: 'New' })`. Assert `setImmediate` was NOT called.
   - All three tests FAIL because the constructor still takes only 3 args.
2. GREEN:
   - Extend constructor with `embedder?: EmbeddingPort` (4th param).
   - Define module-level `const EMBEDDING_TEXT_FIELDS = new Set<UpdateProductInputKeys>(['name','description','supplier']);` (or use the `!== undefined` check directly per design.md §3 R8).
   - Compute `const shouldReembed = input.name !== undefined || input.description !== undefined || input.supplier !== undefined;`.
   - AFTER `products.update()` and AFTER the existing alert check, if `shouldReembed && this.embedder`, fire `setImmediate(() => embedInBackground(product, this.embedder, this.products, logger));`.
3. Refactor the existing `update-product.test.ts` if needed: existing 3-arg constructor call sites must still compile.

**Acceptance**:

- [x] Constructor accepts optional embedder (4th arg) <!-- sdd-owner: implementation -->
- [x] Text-field changes schedule the embed (Scenario 8.1, 8.3) <!-- sdd-owner: implementation -->
- [x] Stock-only changes do NOT schedule the embed (Scenario 8.2) <!-- sdd-owner: implementation -->
- [x] No embedder injected → never schedules the embed regardless of input <!-- sdd-owner: implementation -->
- [x] Existing `update-product.test.ts` still passes unchanged <!-- sdd-owner: implementation -->
- [x] all tests pass (vitest run includes `update-product.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [x] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [x] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: detect "field sent" by `!== undefined`, not by `field in input` — the latter would break if a caller sends `name: null`. Use exactly the design.md §3 R8 logic.

### Task 9.2: Implement `embedInBackground` for the update path (reuse from Group 8 or local copy)

**Layer**: application
**Files**:

- MODIFIED: `packages/backend/src/products/application/update-product.ts` (fill in `embedInBackground` — same shape as create)
- MODIFIED: `packages/backend/src/products/application/update-product.embedding.test.ts` (extend with fail-open test)

**Spec reference**: Requirement 8 + Requirement 7 (fail-open semantics apply symmetrically)
**TDD cycle**: GREEN → TRIANGULATE

**Steps**:

1. Either (a) extract `embedInBackground` to a shared `products/application/_embed-in-background.ts` module so create + update both import it (preferred — DRY), OR (b) duplicate the helper. Add the extraction as a small refactor: NEW `packages/backend/src/products/application/embed-in-background.ts`, then modify both `create-product.ts` and `update-product.ts` to import it. Keep the helper private (not exported via any index).
2. Triangulate the fail-open path:
   - Stub `embeddingPort.embed` to reject after 3 attempts.
   - Call `execute(id, { name: 'New' })`.
   - Assert `execute` resolves; `repo.updateEmbedding` NOT called; warning log captured.
3. Verify the text-field trigger is robust: pass an empty-string name `{ name: '' }` and assert re-embed IS still scheduled (the spec triggers on "field present", not on "value changed").

**Acceptance**:

- [x] Embed helper is shared between create and update (DRY) <!-- sdd-owner: implementation -->
- [x] Fail-open semantics identical in update path (mirror of Scenario 7.2) <!-- sdd-owner: implementation -->
- [x] Empty-string field passes the `!== undefined` check and still re-embeds <!-- sdd-owner: implementation -->
- [x] all tests pass (vitest run includes `update-product.embedding.test.ts`) <!-- sdd-owner: implementation -->
- [x] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [x] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: extracting a shared helper means Group 8 commits and Group 9 commits can reference the same module. If committed together with Group 8, no follow-up merge needed; if separate, both should `import` from the new file from the start.

---

## Group 10: Application — Semantic search use case

> Goal: validate the query, call the embedder (blocking), call the repo, return mapped products.

### Task 10.1: Create the `SemanticSearchUseCase` skeleton (constructor + validation)

**Layer**: application
**Files**:

- NEW: `packages/backend/src/products/application/semantic-search-products.ts`
- NEW: `packages/backend/src/products/application/semantic-search-products.test.ts` (RED: short query rejected; valid query calls embedder + repo)

**Spec reference**: Requirement 9
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `semantic-search-products.test.ts` with:
   - Stub `EmbeddingPort` + `ProductRepository`.
   - Validation test: call `useCase.execute({ query: 'ab', limit: 10 })` → assert `InvalidSemanticSearchQueryError` thrown, `embedder.embed` NOT called.
   - Validation test: 1025-char query → same error, embedder NOT called.
   - Happy path test: query of 50 chars → `embedder.embed` called once with that query, `productRepo.findByEmbedding` called with `[...vector]` and `{ limit: 10 }`, returns `{ items: [stubProduct, stubProduct], total: 2 }`.
   - Test FAILS because the module doesn't exist.
2. GREEN: implement per design.md §3 R9:
   - `class SemanticSearchUseCase { constructor(embedder, productRepo) {} async execute({ query, limit }) {} }`.
   - Validate `query.length < 3 || query.length > 1024` → throw `new InvalidSemanticSearchQueryError(query)`.
   - `const vector = await this.embedder.embed(query);`
   - `const results = await this.productRepo.findByEmbedding([...vector], { limit });`
   - Return `{ items: results.map((r) => Product.rehydrate(r)), total: results.length }`.
3. Reuse existing `Product` aggregate via `import { Product } from '../domain/product.js'`.

**Acceptance**:

- [ ] Scenarios 9.2 + 9.3 covered (queries <3 and >1024 rejected, no embed call) <!-- sdd-owner: implementation -->
- [ ] Scenario 9.1 happy-path covered (valid query → embed + find + mapped) <!-- sdd-owner: implementation -->
- [ ] Return shape matches `{ items: Product[], total: number }` exactly <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `semantic-search-products.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: `Product.rehydrate` is the established pattern in create/update use cases — keep it consistent here.

### Task 10.2: TRIANGULATE — embedder failure surfaces as `EmbeddingProviderUnavailableError`

**Layer**: application
**Files**:

- MODIFIED: `packages/backend/src/products/application/semantic-search-products.test.ts` (extend with Scenario 9.4)

**Spec reference**: Requirement 9 (Scenario 9.4)
**TDD cycle**: TRIANGULATE only

**Steps**:

1. Add Scenario 9.4: stub `embedder.embed` to reject with `EmbeddingProviderUnavailableError('gemini','HTTP 500')`. Call `useCase.execute({ query: 'laptop', limit: 5 })`. Assert:
   - The promise rejects with the SAME error (not a wrapped one).
   - `productRepo.findByEmbedding` is NOT called.
2. Add a fourth test: query exactly 1024 chars is allowed (boundary), query exactly 1025 chars is rejected.

**Acceptance**:

- [ ] Scenario 9.4 covered: embedder failure propagates verbatim; no repo call <!-- sdd-owner: implementation -->
- [ ] Boundary tests at 1024/1025 chars pass <!-- sdd-owner: implementation -->
- [ ] Use case stays free of `process.env` access (Requirement 12 cross-check) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `semantic-search-products.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: the 503 mapping for HTTP responses is the handler's job (Group 11) — this use case just throws.

---

## Group 11: Interface — Semantic search handler + route registration

> Goal: expose `POST /api/v1/products/semantic-search` with JWT auth, Zod input validation, use-case execution, and per-error HTTP mapping (200 / 400 / 503).

### Task 11.1: Create the handler with Zod body validation (RED: invalid body)

**Layer**: interface (handler)
**Files**:

- NEW: `packages/backend/src/products/interface/handlers/semantic-search-products.ts`
- NEW: `packages/backend/src/products/interface/handlers/semantic-search-products.test.ts` (RED: 400 on too-short q)

**Spec reference**: Requirement 10
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `semantic-search-products.test.ts` with `vi.mock` for JWT middleware (return a valid token stub). Build a stubbed `bootstrap` object exposing `embeddingPort`, `productRepo`, `semanticSearchUseCase`. Assert:
   - Body `{ q: 'ab' }` → response 400 with code `INVALID_SEMANTIC_SEARCH_QUERY`.
   - Body `{}` (missing q) → 400.
   - Body `{ q: 'laptop', limit: 200 }` (limit > 50) → 400.
   - Tests FAIL because the handler file doesn't exist.
2. GREEN: implement the handler per design.md §3 R10:
   - Zod schema: `SemanticSearchSchema = z.object({ q: z.string().min(3).max(1024), limit: z.number().int().min(1).max(50).default(10) })`.
   - JWT verification at top.
   - On `safeParse` failure → 400 with code `INVALID_SEMANTIC_SEARCH_QUERY`.
   - On `InvalidSemanticSearchQueryError` from the use case → 400 (already mapped by the use case, but the handler also catches and returns 400 explicitly to be defensive).

**Acceptance**:

- [ ] Scenario 10.2 covered: too-short q → 400 with correct code in body <!-- sdd-owner: implementation -->
- [ ] Missing q → 400 <!-- sdd-owner: implementation -->
- [ ] `limit: 200` → 400 (Zod caps at 50 before it reaches the use case) <!-- sdd-owner: implementation -->
- [ ] JWT middleware is invoked before the use case <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `semantic-search-products.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep the handler signature `(event, ctx, bootstrap)` to match the existing `SubHandler` pattern in `lambda/handler.ts`.

### Task 11.2: Implement happy path (200) and provider-unavailable (503) responses

**Layer**: interface (handler)
**Files**:

- MODIFIED: `packages/backend/src/products/interface/handlers/semantic-search-products.ts` (full implementation)
- MODIFIED: `packages/backend/src/products/interface/handlers/semantic-search-products.test.ts` (extend with 200 + 503)

**Spec reference**: Requirement 10 (Scenarios 10.1, 10.3)
**TDD cycle**: GREEN → TRIANGULATE

**Steps**:

1. Implement the success path:
   - `const useCase = new SemanticSearchUseCase(bootstrap.embeddingPort!, bootstrap.productRepo!);`
   - `const result = await useCase.execute({ query: q, limit });`
   - Return `{ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: result.items, total: result.total }) }`.
2. Implement the 503 path: in the catch block, `if (thrown instanceof EmbeddingProviderUnavailableError) return { statusCode: 503, headers: {...}, body: JSON.stringify({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE', provider: thrown.provider, retryAfter: 60 }) }`. Fallback to `toErrorResponse(thrown, ctx)` for anything else.
3. TRIANGULATE:
   - Happy path test: stubbed embedder returns a 768-dim vector, stubbed repo returns 2 products. Assert 200, body shape, both items.
   - 503 test: embedder rejects with `EmbeddingProviderUnavailableError`. Assert 503, body has `code: 'EMBEDDING_PROVIDER_UNAVAILABLE'`, `provider: 'gemini'`, `retryAfter: 60`.
   - JWT failure test: `verifyJwt` throws → mapped through `toErrorResponse` (assert 401 envelope — verify existing JWT error mapping is unchanged).

**Acceptance**:

- [ ] Scenario 10.1: 200 + `{ items, total }` body shape <!-- sdd-owner: implementation -->
- [ ] Scenario 10.3: 503 + `{ code, provider, retryAfter: 60 }` body shape <!-- sdd-owner: implementation -->
- [ ] JWT failure path delegates to `toErrorResponse` (no change in existing behavior) <!-- sdd-owner: implementation -->
- [ ] Default `limit=10`, max `limit=50` enforced by Zod before use case <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `semantic-search-products.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: do NOT call `useCase.execute` with a separate input — keep the `query`/`limit` shape aligned with the use case's `SemanticSearchInput`.

### Task 11.3: Register the new route in `lambda/handler.ts` `ROUTE_MAP`

**Layer**: interface (Lambda dispatch)
**Files**:

- MODIFIED: `packages/backend/src/lambda/handler.ts` (add import + ROUTE_MAP entry)

**Spec reference**: Requirement 10 (route wired) + Requirement 11 (single Lambda dispatch)
**TDD cycle**: none (route map is a static registry; verification by existing handler dispatch test or a focused unit test)

**Steps**:

1. Add at the top of `lambda/handler.ts` with the other product handler imports:
   `import { handler as semanticSearchProducts } from '../products/interface/handlers/semantic-search-products.js';`
2. Add a `ROUTE_MAP` entry under the existing products routes:
   `'POST /api/v1/products/semantic-search': semanticSearchProducts as SubHandler,`
3. Confirm the existing `dispatch` logic in the same file dispatches by `routeKey` and would surface the new route on a matching key.

**Acceptance**:

- [ ] `ROUTE_MAP` contains `'POST /api/v1/products/semantic-search'` <!-- sdd-owner: implementation -->
- [ ] Import path resolves at type-check time <!-- sdd-owner: implementation -->
- [ ] Existing dispatch tests pass unchanged <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: keep the import grouped with the other products imports for diff hygiene.

---

## Group 12: Bootstrap wiring (composition root)

> Goal: extend `bootstrapProducts()` to resolve the API key, build the embedder, and inject it into the three use cases. Cold-start only — warm invocations reuse the singleton.

### Task 12.1: Extend `bootstrapProducts()` to wire the `EmbeddingPort`

**Layer**: architecture (composition root)
**Files**:

- MODIFIED: `packages/backend/src/products/bootstrap.ts`
- NEW: `packages/backend/src/products/bootstrap.test.ts` (RED: mock resolver + factory, assert wiring + singleton)

**Spec reference**: Requirement 11
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: write `bootstrap.test.ts` with `vi.mock` for the resolver and the factory:
   - Mock `resolveGeminiApiKey` → returns `'sk-test-key'`.
   - Mock `buildEmbeddingProvider` → returns a stub `EmbeddingPort` (capture the settings argument).
   - Call `bootstrapProducts(mockDb)` once. Assert:
     - `resolveGeminiApiKey` was called once.
     - `buildEmbeddingProvider` was called with `{ provider: 'gemini', apiKey: 'sk-test-key', logger: ... }` (env defaults to gemini when `EMBEDDING_PROVIDER` is unset).
     - `createProduct`/`updateProduct` constructors received an `EmbeddingPort` (assert via accessible handle).
     - `bootstrap.embeddingPort` is the SAME reference as the returned stub.
   - Call `bootstrapProducts()` a second time. Assert `resolveGeminiApiKey` was NOT called again and `buildEmbeddingProvider` was NOT called again. (Both mocks' `mock.calls.length` stays at 1.)
   - Reset the `globalThis.__mercadoExpressProducts` cache between tests.
   - Tests FAIL because the bootstrap does not yet call these.
2. GREEN: per design.md §3 R11:
   - Import `resolveGeminiApiKey`, `buildEmbeddingProvider`, `SemanticSearchUseCase`.
   - In `bootstrapProducts()`, compute `const apiKey = await resolveGeminiApiKey(logger);`.
   - Compute `const provider = process.env['EMBEDDING_PROVIDER'] ?? 'gemini';`.
   - Build `const embeddingPort = buildEmbeddingProvider({ provider, apiKey, logger });`.
   - Pass `embeddingPort` to `CreateProductUseCase`, `UpdateProductUseCase`.
   - Add `semanticSearch: new SemanticSearchUseCase(embeddingPort, productRepo)` to the returned object — used by the handler in Group 11.2 (note: the handler currently constructs the use case inline; for consistency we expose `semanticSearch` from bootstrap too).
3. Add the resolution step BEFORE the use-case construction (so embedder is available when use cases are instantiated).

**Acceptance**:

- [ ] `bootstrapProducts()` calls resolver + factory exactly once on cold start (Scenario 11.1) <!-- sdd-owner: implementation -->
- [ ] Second call does NOT re-call resolver or factory (Scenario 11.2) <!-- sdd-owner: implementation -->
- [ ] `embeddingPort` is passed to `CreateProductUseCase`, `UpdateProductUseCase`, and `SemanticSearchUseCase` <!-- sdd-owner: implementation -->
- [ ] `ProductsBootstrap` interface extended with `embeddingPort: EmbeddingPort` and `semanticSearch: SemanticSearchUseCase` <!-- sdd-owner: implementation -->
- [ ] Existing bootstrap consumers (handlers, dev-server) still compile <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `bootstrap.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: the singleton branch (`if (g.__mercadoExpressProducts) return g.__mercadoExpressProducts`) MUST happen BEFORE `await resolveGeminiApiKey` — otherwise warm invocations would re-call SSM. Make sure the resolution is INSIDE the cold-start branch.

### Task 12.2: Harden bootstrap error semantics (factory errors surface at cold start, not first request)

**Layer**: architecture (composition root)
**Files**:

- MODIFIED: `packages/backend/src/products/bootstrap.ts` (add failure logging + assert no fatal errors pass silently)
- MODIFIED: `packages/backend/src/products/bootstrap.test.ts` (add failure assertion)

**Spec reference**: Requirement 11 + Requirement 3 (factory throws on misconfiguration)
**TDD cycle**: GREEN → TRIANGULATE

**Steps**:

1. Wrap the resolver call in a try/catch that logs a structured error and rethrows (so a Lambda cold-start with a missing key fails fast, not at first request).
2. TRIANGULATE — add a test where the mocked resolver rejects with `EmbeddingProviderUnavailableError`:
   - Assert `bootstrapProducts()` rejects with the same error.
   - Assert the captured log entry contains the error code and an operational hint.
3. Add a test where the factory throws (provider='openai' before that adapter exists):
   - Assert `bootstrapProducts()` rejects with `EmbeddingProviderUnavailableError('openai','unknown-provider')`.

**Acceptance**:

- [ ] Resolver failure causes `bootstrapProducts()` to reject (fail-fast at cold start) <!-- sdd-owner: implementation -->
- [ ] Factory unknown-provider error propagates as `EmbeddingProviderUnavailableError` <!-- sdd-owner: implementation -->
- [ ] Structured error log captured at cold-start failure <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `bootstrap.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: failing fast at cold start is the correct operational behavior — a Lambda that boots cleanly but fails on the first request creates warm-invocation pool poisoning.

---

## Group 13: Architecture discipline test

> Goal: enforce that domain/ and application/ contain zero AI SDK imports and zero `process.env` access. Mirrors `cross-bc-bounds.test.ts`.

### Task 13.1: Add the embedding-layer-discipline architecture test

**Layer**: architecture-test
**Files**:

- NEW: `packages/backend/test/architecture/embedding-layer-discipline.test.ts`

**Spec reference**: Requirement 12 (all 3 scenarios)
**TDD cycle**: RED → GREEN

**Steps**:

1. RED: temporarily add `import { something } from '@google/generative-ai';` to `packages/backend/src/products/application/create-product.ts`. Run the new test file — assert it FAILS with the expected offender path. Revert the temporary import before committing.
2. GREEN: implement the test per design.md §3 R12:
   - Walk `products/domain/` and `products/application/` recursively.
   - For each `.ts` (excluding `.test.ts`):
     - Scan for `import ... from '@google/generative-ai' | '@google-cloud/vertexai' | 'openai' | '@anthropic-ai/sdk' | 'voyageai' | 'ollama'` (forbidden SDKs).
     - Scan for `process.env` (only forbidden in `domain/`).
   - Collect offenders; assert empty array.
   - Mirror the existing `cross-bc-bounds.test.ts` structure (`readdirSync`, regex, `relative(process.cwd(), file)`).
3. TRIANGULATE: add a third test for `application/process.env` to match the spirit of Requirement 12.3 (any layer-direct env access outside infrastructure is a discipline violation).

**Acceptance**:

- [ ] Scenario 12.1: zero SDK imports under `products/domain/` <!-- sdd-owner: implementation -->
- [ ] Scenario 12.2: zero SDK imports under `products/application/` <!-- sdd-owner: implementation -->
- [ ] Scenario 12.3: zero `process.env` references under `products/domain/` <!-- sdd-owner: implementation -->
- [ ] RED cycle verified (temp import caused failure; remove caused pass) <!-- sdd-owner: implementation -->
- [ ] all tests pass (vitest run includes `embedding-layer-discipline.test.ts`) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: do NOT add a forbidden SDK list to `package.json#dependencies` — the test is the discipline guard, not the package manager.

---

## Group 14: CDK changes (infrastructure-as-code)

> Goal: provision the SSM SecureString parameter, add the new route to API Gateway, grant IAM `ssm:GetParameter` to the Lambda role.

### Task 14.1: Add the `gemini-api-key` SSM SecureString parameter to the infra stack

**Layer**: infra (CDK)
**Files**:

- MODIFIED: `packages/infra/src/stacks/DatabaseStack.ts` (add `StringParameter` with `SecureString` type) OR NEW helper method on the existing stack

**Spec reference**: Requirement 4 (SSM path `/ceiba/{stage}/gemini-api-key`)
**TDD cycle**: CDK synth IS the test — verification by `cdk synth` not failing and the template containing the parameter

**Steps**:

1. Inside `DatabaseStack` constructor (or a new helper `addGeminiApiKey()` method to keep the constructor tidy):

   ```typescript
   new ssm.StringParameter(this, 'GeminiApiKey', {
     parameterName: `/ceiba/${stage}/gemini-api-key`,
     stringValue: 'PLACEHOLDER_REPLACE_AT_DEPLOY',
     type: ssm.ParameterType.SECURE_STRING,
     description: `MercadoExpress ${stage} Gemini API key for product semantic search`,
     tier: ssm.ParameterTier.STANDARD,
   });
   ```

2. Add imports: `import * as ssm from 'aws-cdk-lib/aws-ssm';`.
3. Run `pnpm --filter @mercadoexpress/infra synth --context stage=dev` (or the project's equivalent CDK synth command). Confirm the synthesized CFN template contains `MercadoExpress-dev-gemini-api-key` (or similar naming) and the parameter is declared as `Type: SecureString`.

**Acceptance**:

- [ ] `cdk synth` succeeds with no errors <!-- sdd-owner: implementation -->
- [ ] Synthesized template declares `AWS::SSM::Parameter` with type `SecureString` and the expected parameter name pattern `/ceiba/{stage}/gemini-api-key` <!-- sdd-owner: implementation -->
- [ ] No new CFN outputs are introduced (keep the new resource private to the stack) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: the placeholder value approach mirrors the existing `admin-password`/`jwt-secret` patterns in the same stack. Real values are injected via CI secrets in a follow-up ops step.

### Task 14.2: Add the new route + IAM `ssm:GetParameter` permission in `ApiStack`

**Layer**: infra (CDK)
**Files**:

- MODIFIED: `packages/infra/src/stacks/ApiStack.ts` (add route to `LAMBDAS[0].routes`, add IAM statement, add env var `EMBEDDING_PROVIDER`)

**Spec reference**: Requirement 4 (IAM permission) + Requirement 10 (route provisioned)
**TDD cycle**: CDK synth IS the test (RED = run synth before changes, observe missing route; GREEN = run synth after, observe route present)

**Steps**:

1. RED verification: run `cdk synth` BEFORE making changes. Note that the route `POST /api/v1/products/semantic-search` is NOT in the synthesized template.
2. GREEN: edit `ApiStack.ts`:
   a. Add to `LAMBDAS[0].routes` (alongside the existing `/api/v1/products` entries):
   `{ path: '/api/v1/products/semantic-search', methods: [apigwv2.HttpMethod.POST] },`
   b. Add `EMBEDDING_PROVIDER: stage === 'local' ? 'gemini' : 'gemini'` to the consolidated NodejsFunction `environment` (mirror other stage-agnostic env vars like `LOG_LEVEL`).
   c. Add to `consolidatedFn.role!.addToPrincipalPolicy(...)` (extend the existing list rather than adding a new statement):

   ```typescript
   new iam.PolicyStatement({
     effect: iam.Effect.ALLOW,
     actions: ['ssm:GetParameter'],
     resources: [
       `arn:aws:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/ceiba/${stage}/gemini-api-key`,
     ],
   });
   ```

   d. Run `cdk synth` again. Confirm:
   - The synthesized template contains `POST /api/v1/products/semantic-search` route.
   - `AWS::IAM::Policy` document contains `ssm:GetParameter` action with the parameter ARN pattern.
   - `EMBEDDING_PROVIDER` env var is set on the function.

**Acceptance**:

- [ ] `cdk synth` succeeds <!-- sdd-owner: implementation -->
- [ ] Route `POST /api/v1/products/semantic-search` present in the synthesized API Gateway HTTP API v2 routes <!-- sdd-owner: implementation -->
- [ ] IAM policy statement grants `ssm:GetParameter` to the consolidated Lambda role for the parameter ARN <!-- sdd-owner: implementation -->
- [ ] `EMBEDDING_PROVIDER` env var set on the function <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: use `Aws.REGION` and `Aws.ACCOUNT_ID` (CDK tokens) — do NOT hardcode `us-east-1`.

### Task 14.3: TRIANGULATE — full CDK synth + JSON snapshot for the new route + permission

**Layer**: infra (CDK)
**Files**:

- NEW: `packages/infra/test/api-stack.semantic-search.test.ts` (snapshot assertion using existing infra test pattern if present, otherwise inline assertions against the synthesized template)

**Spec reference**: Requirement 10 + Requirement 4 (IAM)
**TDD cycle**: TRIANGULATE only

**Steps**:

1. Add an assertion-based test (snapshot or property match) that:
   - Reads `ApiStack.synth` output (or calls CDK's programmatic synthesis via `Testing.app()`).
   - Asserts the template contains the new route name.
   - Asserts the IAM policy contains `ssm:GetParameter`.
   - Asserts the env var `EMBEDDING_PROVIDER` is set to `gemini`.
2. If no infra test harness exists yet, fall back to a manual snapshot file (commit it under `packages/infra/test/__snapshots__/`) updated by the change.

**Acceptance**:

- [ ] Snapshot/assertion test passes <!-- sdd-owner: implementation -->
- [ ] Snapshot commits reflect the new route + IAM + env var (committed to git) <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: if a snapshot test framework is not yet established in this monorepo, defer this task and rely on `cdk synth` as the gate. The user can pick this up post-apply if needed.

---

## Group 15: End-to-end smoke (Playwright against deployed dev)

> Goal: black-box smoke test for the new endpoint. Out-of-the-box test scaffolding for the e2e directory is created here.

### Task 15.1: Create the e2e test directory and the semantic-search spec

**Layer**: architecture-test (e2e)
**Files**:

- NEW: `tests/e2e/semantic-search.spec.ts` (Playwright spec)
- NEW: `tests/e2e/helpers/jwt.ts` (small helper to mint a dev JWT — optional, may live inline)
- NEW: `tests/e2e/playwright.config.ts` (basic config if the project has no e2e config yet — likely needed)

**Spec reference**: Requirement 10 (end-to-end happy path)
**TDD cycle**: none for the test SCAFFOLDING itself — the test is the deliverable. Pre-apply, verify the spec compiles. Post-deploy, run against dev to triangulate.

**Steps**:

1. Scaffold the e2e directory (`tests/e2e/`) if it does not exist; the existing test layout uses `vitest` for unit tests, not Playwright. This task creates the Playwright setup as a sibling.
2. Write `semantic-search.spec.ts`:
   - `test('returns 200 with items on a valid query', async ({ request }) => { ... })`.
   - Mint a dev JWT (via the existing helper or inline using `jose` if it's a workspace dep).
   - `POST ${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}/api/v1/products/semantic-search` with `Authorization: Bearer <jwt>` header and body `{ q: 'laptop', limit: 10 }`.
   - Assert `response.status() === 200` and `body.items` is an array.
3. Add an `e2e:ignore` test for the failure path that is hard to reproduce without breaking dev Gemini — note in the file header that the 503 path is covered by Group 11.2 unit tests.
4. Wire the test into the project's CI workflow OR document a manual `pnpm test:e2e` step in `packages/backend/package.json`.

**Acceptance**:

- [ ] `tests/e2e/semantic-search.spec.ts` compiles <!-- sdd-owner: implementation -->
- [ ] Spec asserts 200 response with `{ items, total }` body shape <!-- sdd-owner: implementation -->
- [ ] Spec uses JWT auth (same pattern as other products endpoints) <!-- sdd-owner: implementation -->
- [ ] All e2e config files present and reference the existing dev/test setup <!-- sdd-owner: implementation -->
- [ ] no type errors (tsc --noEmit clean) <!-- sdd-owner: implementation -->
- [ ] no lint errors (eslint clean) <!-- sdd-owner: implementation -->

**Notes**: this task creates the directory + spec. The actual RUN against deployed dev happens in the apply phase against a deployed stack — surfaced as a manual smoke verification, not a CI-required check.

---

## Summary

- **Total tasks**: 34 (15 groups, with Task 1.5 added for pino redaction per spec R4 Scenario 4.4)
- **New files**: 19 (includes 10 test files: red-fixture and triangulation tests)
- **Modified files**: 10 (`packages/shared/src/errors/errorCodes.ts`, `packages/backend/src/shared/error-mapper.ts`, `packages/backend/src/shared/logger.ts`, `packages/backend/src/products/bootstrap.ts`, `.env.dev.example`, `.env.example`, `packages/backend/src/db/schema.ts`, `packages/backend/drizzle/meta/_journal.json`, `packages/backend/src/products/application/create-product.ts`, `packages/backend/src/products/application/update-product.ts`, `packages/backend/src/products/domain/ports/product-repository.ts`, `packages/backend/src/products/infrastructure/drizzle-product-repository.ts`, `packages/backend/src/lambda/handler.ts`, `packages/backend/package.json`, `packages/infra/src/stacks/DatabaseStack.ts`, `packages/infra/src/stacks/ApiStack.ts` — count is 16 modified, sum to 19 new + 16 modified = 35 total)

> **Revised final count after head-count:**
>
> - **New files**: 19
> - **Modified files**: 16
> - **Test files added**: 10 (counted under new files above; 5 RED fixtures + 5 triangulation/extension)
> - **Total authored LOC estimate**: ~820–880 (impl ~600 + tests ~250 + CDK ~30 + e2e ~40)

- **Strict TDD**: every production task follows RED → GREEN → TRIANGULATE (CDK uses `cdk synth` as the test).
- **Review budget status**: **REQUIRES size exception OR chained PRs** — estimated ~820–880 LOC exceeds the 400-line budget.
  - **Recommendation**: single PR + `size:exception` (smaller coordination surface).
  - **Alternative split**: PR slice 1 = Groups 1–4, 14.1 (~350 LOC, vertical slice: error contract → port → schema → SSM CDK). PR slice 2 = Groups 5–15, 14.2–14.3 (~480 LOC, depends on slice 1).
  - **Decision** lives with parent before apply. Mark `Decision needed before apply: Yes`.

### Suggested commit map (per work-unit-commits skill — one cohesive unit per commit)

| #   | Commit subject                                                                  | Tasks            |
| --- | ------------------------------------------------------------------------------- | ---------------- |
| C1  | `feat(shared): add embedding error codes and classes`                           | 1.1, 1.2         |
| C2  | `feat(backend): wire embedding errors in error mapper and pino redaction`       | 1.3, 1.5         |
| C3  | `chore(env): document EMBEDDING_PROVIDER + GEMINI_API_KEY env vars`             | 1.4              |
| C4  | `feat(products): define EmbeddingPort domain interface`                         | 2.1              |
| C5  | `feat(db): add nullable vector(768) column and HNSW index migration`            | 3.1, 3.2, 3.3    |
| C6  | `feat(products): extend ProductRepository with findByEmbedding/updateEmbedding` | 4.1, 4.2         |
| C7  | `feat(embedding): resolve Gemini API key from SSM with cold-start cache`        | 5.1, 5.2         |
| C8  | `feat(embedding): implement GeminiEmbeddingAdapter with 3-attempt retry`        | 6.1, 6.2, 6.3    |
| C9  | `feat(embedding): add EmbeddingFactory with provider-based memoization`         | 7.1, 7.2         |
| C10 | `feat(products): auto-embed new products on create (fire-and-forget)`           | 8.1, 8.2         |
| C11 | `feat(products): re-embed products on text-field updates only`                  | 9.1, 9.2         |
| C12 | `feat(products): add SemanticSearchUseCase with query validation`               | 10.1, 10.2       |
| C13 | `feat(api): expose POST /api/v1/products/semantic-search handler`               | 11.1, 11.2, 11.3 |
| C14 | `feat(products): wire EmbeddingPort into bootstrap composition root`            | 12.1, 12.2       |
| C15 | `test(architecture): enforce zero AI SDK imports in domain/application`         | 13.1             |
| C16 | `feat(infra): provision SSM SecureString gemini-api-key and route + IAM`        | 14.1, 14.2, 14.3 |
| C17 | `test(e2e): add Playwright smoke for semantic-search endpoint`                  | 15.1             |

> With this commit map, if `size:exception` is denied, PR slice 1 maps to commits C1–C6 + C16's first part (SSM only), and PR slice 2 to C7–C15 + C16's second part (route + IAM).

---

## Parent review and lifecycle actions (AFTER apply completes)

These actions are explicitly owned by the parent orchestrator and run AFTER `sdd-apply` checks off the implementation checkboxes above.

- [ ] Run `gentle-ai review start --target <diff>` against the merged commit set to obtain a fresh bounded-review receipt (Requirement N/A; one receipt for the PR diff). <!-- sdd-owner: parent -->
- [ ] Run `gentle-ai review validate --gate pre-commit --cwd <repo>` after staging all reviewed paths to confirm the receipt is still valid before commit. <!-- sdd-owner: parent -->
- [ ] Run `gentle-ai review validate --gate pre-push --cwd <repo>` before pushing the branch. <!-- sdd-owner: parent -->
- [ ] Run `gentle-ai review validate --gate pre-pr --cwd <repo>` before opening the GitHub PR to confirm the candidate tree, paths, policy, evidence, base relationship, and receipt all align. <!-- sdd-owner: parent -->
- [ ] After PR merge (or before release), run `gentle-ai review validate --gate release --cwd <repo>` to confirm the immutable release tree, provenance, evidence, and publication boundary. <!-- sdd-owner: parent -->
- [ ] After all 12 spec requirements validated by `sdd-verify`, hand off to `sdd-archive` to close the change and persist final state. <!-- sdd-owner: parent -->

> No implementation work above this line is owned by the parent. Parent actions are queued here for orchestration visibility only.

---

## Spec → task coverage map (12 requirements × 34 tasks)

| Requirement                            | Tasks                        |
| -------------------------------------- | ---------------------------- |
| R1 — EmbeddingPort contract            | 2.1                          |
| R2 — GeminiEmbeddingAdapter            | 6.1, 6.2, 6.3                |
| R3 — EmbeddingFactory                  | 7.1, 7.2                     |
| R4 — SSM API key resolution            | 5.1, 5.2, 1.5                |
| R5 — Drizzle migration + schema        | 3.1, 3.2, 3.3                |
| R6 — ProductRepository.findByEmbedding | 4.1, 4.2                     |
| R7 — CreateProductUseCase integration  | 8.1, 8.2                     |
| R8 — UpdateProductUseCase integration  | 9.1, 9.2                     |
| R9 — SemanticSearchUseCase             | 10.1, 10.2                   |
| R10 — Semantic search handler + route  | 11.1, 11.2, 11.3, 15.1 (e2e) |
| R11 — Bootstrap wiring                 | 12.1, 12.2                   |
| R12 — Hexagonal layer discipline       | 13.1                         |

Cross-cutting shared concerns: 1.1, 1.2, 1.3, 1.4. CDK: 14.1, 14.2, 14.3.

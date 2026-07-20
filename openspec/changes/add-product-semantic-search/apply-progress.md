# Apply Progress: add-product-semantic-search

**Change:** `add-product-semantic-search`
**Branch:** `feat/product-semantic-search`
**Artifact store:** openspec
**Strict TDD:** ACTIVE
**Delivery:** single PR + size exception

---

## Group 1: Shared foundation (errors, env, redaction)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 1.1: Add 3 error codes to shared ErrorCode registry
- [x] 1.2: Add 3 domain error classes extending BaseDomainError
- [x] 1.3: Wire EmbeddingProviderUnavailableError into error mapper
- [x] 1.4: Update .env.dev.example and .env.example with embedding variables
- [x] 1.5: Add pino redaction rules for apiKey/GEMINI_API_KEY

### Files added

- `packages/shared/src/errors/errorCodes.ts` (modified — added 3 error codes)
- `packages/backend/test/shared/error-codes.embedding.test.ts` (RED fixture — 3 tests, all pass)
- `packages/backend/src/products/domain/errors/embedding-provider-unavailable.ts` (new — 503 error)
- `packages/backend/src/products/domain/errors/embedding-input-too-long.ts` (new — 400 error)
- `packages/backend/src/products/domain/errors/invalid-semantic-search-query.ts` (new — 400 error)
- `packages/backend/src/products/domain/errors/embedding-errors.test.ts` (RED fixture — 15 tests, all pass)
- `packages/backend/src/shared/error-mapper.ts` (modified — added EmbeddingProviderUnavailableError branch)
- `packages/backend/src/shared/error-mapper.embedding.test.ts` (RED fixture — 3 tests, all pass)
- `packages/backend/src/shared/logger.ts` (modified — added redact paths for apiKey/GEMINI_API_KEY variants)
- `packages/backend/src/shared/logger.redaction.test.ts` (RED fixture — 5 tests, all pass)
- `.env.example` (modified — added EMBEDDING_PROVIDER, GEMINI_API_KEY)
- `.env.dev.example` (modified — added EMBEDDING_PROVIDER, GEMINI_API_KEY)

### Tests passing

- `test/shared/error-codes.embedding.test.ts`: 3/3 ✅
- `src/products/domain/errors/embedding-errors.test.ts`: 15/15 ✅
- `src/shared/error-mapper.embedding.test.ts`: 3/3 ✅
- `src/shared/logger.redaction.test.ts`: 5/5 ✅

### Commit (C1–C3 pending parent validation)

- C1: `feat(shared): add embedding error codes and classes` — Tasks 1.1, 1.2
- C2: `feat(backend): wire embedding errors in error mapper and pino redaction` — Tasks 1.3, 1.5
- C3: `chore(env): document EMBEDDING_PROVIDER + GEMINI_API_KEY env vars` — Task 1.4

### Verification

- `pnpm --filter @mercadoexpress/shared type-check`: ✅ pass
- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass
- Group 1 tests: 26/26 ✅

### Notes

- Shared package rebuilt after error code additions
- Error mapper import path corrected from `../../products/...` to `../products/...`
- Pino redaction paths cover flat + 1-level nested keys for apiKey/GEMINI_API_KEY variants
- Logger.createLogger() extended to accept optional `{level}` and `destination` params for test harness

---

## Group 2: Domain port + interface (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 2.1: Create the EmbeddingPort interface in domain/ports

### Files added

- `packages/backend/src/products/domain/ports/embedding.ts` (new — EmbeddingPort interface)
- `packages/backend/src/products/domain/ports/embedding.test.ts` (RED fixture — 3 tests, all pass)

### Tests passing

- `src/products/domain/ports/embedding.test.ts`: 3/3 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass

---

## Group 3: Database schema + migration (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 3.1: Create idempotent 0001_add_product_embedding.sql migration
- [x] 3.2: Extend Product schema with embedding column (Drizzle vector type)
- [x] 3.3: Update drizzle meta journal

### Files added

- `packages/backend/drizzle/0001_add_product_embedding.sql` (new — idempotent migration)
- `packages/backend/src/db/schema.ts` (modified — added embedding vector column)
- `packages/backend/src/db/schema.embedding.test.ts` (RED fixture — 3 tests, all pass)
- `packages/backend/drizzle/meta/_journal.json` (modified — added 0001 entry)

### Tests passing

- `src/db/schema.embedding.test.ts`: 3/3 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass
- `pnpm --filter @mercadoexpress/backend test`: 293 backend tests ✅

---

## Group 4: ProductRepository with findByEmbedding + updateEmbedding (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 4.1: Extend ProductRepository interface with findByEmbedding + updateEmbedding
- [ ] 4.2: Implement findByEmbedding + updateEmbedding in DrizzleProductRepository (PARTIAL — no tests yet)

### Files modified

- `packages/backend/src/products/domain/ports/product-repository.ts` (extended with 2 methods)
- `packages/backend/src/products/infrastructure/drizzle-product-repository.ts` (added 2 methods)
- `packages/backend/src/products/domain/ports/product-repository.embedding.test.ts` (RED fixtures for 2 new methods)

### Tests passing

- `src/products/domain/ports/product-repository.embedding.test.ts`: 5/5 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass

---

## Group 5: API key resolver (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 5.1: Create api-key-resolver.ts with SSM + local env fallback
- [x] 5.2: Add caching to avoid repeated SSM calls

### Files added

- `packages/backend/src/products/infrastructure/embedding/api-key-resolver.ts` (new)
- `packages/backend/src/products/infrastructure/embedding/api-key-resolver.test.ts` (6 tests, all pass)

### Tests passing

- `src/products/infrastructure/embedding/api-key-resolver.test.ts`: 6/6 ✅

---

## Group 6: GeminiEmbeddingAdapter (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 6.1: Create GeminiEmbeddingAdapter class with httpClient injection
- [x] 6.2: Add 8192-char input validation
- [x] 6.3: Implement retry with exponential backoff (1s/2s/4s)

### Key design decisions

- Added `delayFn?: (ms: number) => Promise<void>` to GeminiAdapterDeps — eliminates fake timer complexity
- Removed duplicate warn() in callGemini; single warn per attempt in withRetry
- 4 total attempts (1 initial + 3 retries), exhausted on attempt 4
- Retry loop: `attempt <= RETRY_DELAYS_MS.length + 1`; isLastAttempt: `attempt > RETRY_DELAYS_MS.length`

### Files added

- `packages/backend/src/products/infrastructure/embedding/gemini-adapter.ts` (new — with injectable delayFn)
- `packages/backend/src/products/infrastructure/embedding/gemini-adapter.test.ts` (8 tests, all pass)

### Tests passing

- `src/products/infrastructure/embedding/gemini-adapter.test.ts`: 8/8 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass
- `pnpm --filter @mercadoexpress/backend test`: 307 backend tests ✅

### Gated commits (blocked — no valid review receipt for new scope)

- C6: `feat(embedding): add GeminiEmbeddingAdapter with httpClient + delayFn injection`

### Notes

- Fake timers abandoned after extensive testing — vi.useFakeTimers() + vi.runAllTimers() hangs in vitest 2.x
- Injectable delayFn is the correct pattern for testability without timer complexity
- Removed stale eslint-disable comment for non-existent `@typescript-eslint/no-float-descriptors` rule

---

## Group 7: EmbeddingFactory (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 7.1: Create `buildEmbeddingProvider` with module-level memoization
- [x] 7.2: TRIANGULATE — singleton on repeat calls (Scenario 3.1 + 3.4)

### Files added

- `packages/backend/src/products/infrastructure/embedding/factory.ts` (new — EmbeddingFactory with gemini memoization)
- `packages/backend/src/products/infrastructure/embedding/factory.test.ts` (5 tests, all pass)

### Tests passing

- `src/products/infrastructure/embedding/factory.test.ts`: 5/5 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass

### Commit (blocked — no valid pre-commit receipt for Groups 7-9 scope)

- C7: `feat(embedding): add EmbeddingFactory with provider-based memoization`

---

## Group 8: CreateProductUseCase — fire-and-forget embed (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 8.1: Add optional `EmbeddingPort` injection to `CreateProductUseCase`
- [x] 8.2: Implement `embedInBackground` — try/catch + log warn + `updateEmbedding` call

### Key design decisions

- `description?: string | null` added to `ProductProps` and `Product` class getter — needed for embed text construction
- `embed-in-background.ts` shared helper created (also used by Group 9)
- `CreateProductUseCase` now accepts optional `embedder?: EmbeddingPort` and `logger?: PinoLogger`
- Test expectation corrected from 3 spaces to 2 spaces (description is undefined in CreateProductInput → `''` via `??`)

### Files added

- `packages/backend/src/products/application/embed-in-background.ts` (shared helper — fire-and-forget embed)
- `packages/backend/src/products/application/create-product.embedding.test.ts` (3 tests, all pass)

### Files modified

- `packages/backend/src/products/domain/product.ts` (added `description?: string | null` to ProductProps + getter)
- `packages/backend/src/db/schema.ts` (added `description: text('description')` column)
- `packages/backend/drizzle/0002_add_product_description.sql` (idempotent migration)
- `packages/backend/drizzle/meta/_journal.json` (added 0002 entry)
- `packages/backend/src/products/application/create-product.ts` (added embedder + logger params, embedInBackground call)

### Tests passing

- `src/products/application/create-product.embedding.test.ts`: 3/3 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass
- `pnpm --filter @mercadoexpress/backend test`: 322 backend tests ✅ (7 new + 315 existing)

### Commit (blocked — no valid pre-commit receipt for Groups 7-9 scope)

- C8: `feat(products): auto-embed new products on create (fire-and-forget)`

---

## Group 9: UpdateProductUseCase — selective re-embed (✅ COMPLETE)

**Status:** ✅ COMPLETE

### Tasks completed

- [x] 9.1: Add optional embedder injection + text-field detection in `UpdateProductUseCase`
- [x] 9.2: Implement `embedInBackground` for the update path (via shared helper)

### Key design decisions

- `UpdateProductInput` extended with `description?: string | null`
- Re-embed triggered when: `input.name !== undefined || input.description !== undefined || input.supplier !== undefined`
- `UpdateProductUseCase` accepts optional `embedder?: EmbeddingPort` and `logger?: PinoLogger`
- Empty-string name `{ name: '' }` IS a text-field change (not undefined) → triggers re-embed
- Fail-open semantics: execute() resolves even when embedder throws after retries

### Files added

- `packages/backend/src/products/application/update-product.embedding.test.ts` (7 tests, all pass)

### Files modified

- `packages/backend/src/products/application/update-product.ts` (added embedder + logger params, shouldReembed detection, setImmediate call)

### Tests passing

- `src/products/application/update-product.embedding.test.ts`: 7/7 ✅

### Verification

- `pnpm --filter @mercadoexpress/backend type-check`: ✅ pass
- `pnpm --filter @mercadoexpress/backend test`: 322 backend tests ✅

### Commit (blocked — no valid pre-commit receipt for Groups 7-9 scope)

- C9: `feat(products): re-embed products on text-field updates only`

---

## Groups 10–15: NOT STARTED

### Commit map (pending)

- Group 10: `feat(products): add SemanticSearchUseCase with query validation`
- Group 11: `feat(api): expose POST /api/v1/products/semantic-search handler`
- Group 12: `feat(products): wire EmbeddingPort into bootstrap composition root`
- Group 13: `test(architecture): enforce zero AI SDK imports in domain/application`
- Group 14: `feat(infra): provision SSM SecureString gemini-api-key and route + IAM`
- Group 15: `test(e2e): add Playwright smoke for semantic-search endpoint`

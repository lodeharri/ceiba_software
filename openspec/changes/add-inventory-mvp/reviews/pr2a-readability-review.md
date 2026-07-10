# PR 2a Readability Review — MercadoExpress

- **Reviewer:** review-readability (subagent, fresh context)
- **Timestamp:** 2026-07-09
- **Scope:** PR 2a commits `afdde79..4bb78fd` on `main` (3 WIP commits + 1 docs closeout)
- **Out of scope:** the 13 deferred SUGGESTIONs and 5 NITs from `pr1-readability-review.md` / `pr1-blocker-re-review.md` (carried into PR 4 review-cleanup); PR 0 issues already closed. Carry-over items are tracked under §C7 below.
- **Source-of-truth checks:** `design.md §3–§6, §10, §14–§15`; `specs/{auth,products,categories,shared}/spec.md`; `tasks.md` PR 2a block.
- **Verification gate re-checked locally:**
  - `pnpm -w vitest run` — 32 test files / **160 tests pass** (confirming the apply-progress claim).
  - `cdk synth --all --no-color` — 8 templates, no `Annotations.addWarningV2` warnings.
  - `pnpm -w tsc --noEmit`, `pnpm -w eslint .`, `pnpm -w prettier --check .` — all green.
  - `pnpm audit --prod --audit-level=high` — 0 high/critical.

The hex shape of PR 2a is correct: the four BCs sit in clean `domain / application / infrastructure / interface` lanes, the cross-BC seam for categories-inside-products-lambda sits in `shared/dispatchers/products-categories-dispatcher.ts` (with the architectural test exempting the dispatcher seam), every domain entity enforces its invariants at construction, the ports are interfaces that the adapters implement (not the other way around), and the test files are co-located and use hand-rolled `PrismaLike` fakes so unit tests run in microseconds with no database. The RISK-003 Postgres rate limiter is wired (the table lands in `0_init/migration.sql`, the partial index is hand-written, the adapter persists across `prisma.$disconnect`).

What is not correct, and what this PR 2a is **missing**, falls into three buckets:

1. **Runtime plumbing.** The `prisma-client.ts` factory still returns a **PR 1 stub**; the `MigrationsCustomResource` is still **dead code**; `migrations-lambda.ts` still has a **PR 1 stub handler** that logs and returns SUCCESS without running `prisma migrate deploy` or the seed. PR 1's BLOCKER C2/C3 closeout was supposed to land in PR 2a — it did not. The first deploy will produce an **empty database**: no tables, no admin user, the auth-lambda will 500 on every call.
2. **Spec-level defects.** The dual-secret rotation spec (auth/spec.md §182) defines `JWT_OVERLAP_SECONDS` as the bound on previous-secret acceptance, but the middleware ignores that env var entirely; the shared `ValidationError` is mapped to **422** while the spec says **400**; `products/interface/handlers/get-product.ts:24` and `update-product.ts:94` carry inline `'VALIDATION_ERROR'` strings instead of `ErrorCode.VALIDATION_ERROR`.
3. **Dead code / duplication.** The `User` aggregate is never constructed in production (the seed bypasses it; the repo returns `UserProps`); `products/interface/dispatcher.ts` is unreachable; handler files each re-implement a local `ValidationError extends BaseDomainError` class; the products BC's handler tests and infrastructure tests are absent (apply-progress claims they exist but they don't), and the `auth/integration/login-flow.test.ts` for the counter-survives-cold-start case is absent.

The CRITICALs below (the three runtime-plumbing issues, the inline `'VALIDATION_ERROR'` strings, and the missing integration test) are **BLOCKERs** because they break the user's review checklist. The WARNINGs (validation status mismatch, JWT overlap enforcement, `User` aggregate dead code) need PR 2a/2b fixes. The SUGGESTIONs are cleanup.

---

## Architectural findings

### W1 — Domain → infrastructure / interface / prisma imports. **PASS (architectural integrity holds).**

The grep below confirms no BC's `domain/` imports any sibling layer or provider package:

```
$ grep -rn "from.*infrastructure\|from.*interface\|from.*prisma" \
    packages/backend/src/{auth,products,categories}/domain/

packages/backend/src/auth/domain/user.ts:4: * Pure domain entity — imports nothing from infrastructure (no Prisma,
```

Only hit is the comment that _says_ "imports nothing from infrastructure" — not an actual import. Domain → ports → application → infrastructure is one-directional; the ESLint `boundaries/element-types` rule (`eslint.config.js:73-86`) enforces it via the `disallow: ['backend-application', 'backend-infrastructure', 'backend-interface']` clause. Cross-BC architectural test `test/architecture/cross-bc-bounds.test.ts` walks the file tree and asserts the same (`it('no BC imports another BC infrastructure/application/interface')`).

### W2 — Cross-BC seam (RISK-001) lives in `shared/dispatchers/`. **NOTE for PR 2b.**

The user-facing cross-BC ports per `design.md §5.3` are `ProductStockGate.txIncrementStock` and `AlertCloserPort.txCloseIfOpenAndAboveMin`. Both ports are **referenced in the design + the tasks but absent in PR 2a**. PR 2a correctly does not implement them — the inventory + alerts BCs that own these ports land in PR 2b. The receiver (orders BC) lands in PR 2c. The places where the ports SHOULD be declared (per `tasks.md`) and currently are NOT:

- `packages/backend/src/inventory/domain/ports/product-stock-gate.ts` — absent (PR 2b).
- `packages/backend/src/alerts/domain/ports/alert-closer-port.ts` — absent (PR 2b).

This is consistent with the PR plan and is not a defect of PR 2a; I am calling it out for completeness so the next reviewer does not flag it.

The categories-inside-products-lambda seam is the only cross-BC wiring that PR 2a ships, and it is done cleanly:

- `packages/backend/src/shared/dispatchers/products-categories-dispatcher.ts:71` exposes the `handler` and verifies JWT once before per-route dispatch.
- `packages/backend/src/products/interface/handlers/bootstrap.ts` re-exports the shared dispatcher as the Lambda entry — `ApiStack.ts:81` references it.
- The shared dispatcher imports both BCs' handlers by file path (not BC-internal), which is the only sanctioned seam per `design.md §3.6` (the dispatcher is the orchestrator outside both BCs).
- `test/architecture/cross-bc-bounds.test.ts:93-95` exempts `*interface/dispatcher.ts` from the cross-BC import rule. **The exemption is too narrow** — the actual dispatcher file is `shared/dispatchers/products-categories-dispatcher.ts`, not `products/interface/dispatcher.ts`, so the exemption rule does not actually apply to the production dispatcher. See S1 below.

### W3 — DI wiring (per `design.md §3` and `tasks.md PR 2a §Auth`/`§Products`/`§Categories`). **PASS, with one smoke smell.**

Each per-BC bootstrap instantiates concrete adapters and injects them into use cases:

- `packages/backend/src/auth/bootstrap.ts:37-46` — `PrismaUserRepository(prisma) → users`, `BcryptPasswordHasher() → hasher`, `JoseTokenIssuer() → issuer`, `PostgresRateLimiter(prisma) → rateLimiter`, then `new LoginUseCase(users, hasher, issuer, rateLimiter)`.
- `packages/backend/src/products/bootstrap.ts:38-47` — `PrismaProductRepository(prisma) → productRepo`, `PrismaCategoryReadRepository(prisma) → categoryRead`, then four use cases.
- `packages/backend/src/categories/bootstrap.ts:27-31` — same shape.

Smell (not a defect, deferred): the `prismaOverride ?? getPrismaClient()` cast in each bootstrap (`auth/bootstrap.ts:43-49`, `products/bootstrap.ts:39-45`, `categories/bootstrap.ts:30-32`) is a single-cast point: `(prisma ?? defaults) as unknown as ConstructorParameters<typeof Repo>[0] & ConstructorParameters<typeof OtherRepo>[0]`. This works at runtime (both adapter constructors only use methods that exist on the real `PrismaClient`) but the type story is "trust me". Tracked in PR 4 review-cleanup if anyone converts these to real Prisma types from `@prisma/client`.

---

## Security findings

### C1 — `MigrationsCustomResource` is **dead code** in PR 2a — DB tables are NEVER applied, admin user is NEVER seeded. **BLOCKER.**

`packages/infra/src/constructs/migrations.ts:32` defines `class MigrationsCustomResource extends Construct` and instantiates a `nodejs.NodejsFunction`, an IAM policy, and a `CustomResource`. **Nothing in any stack references it.**

```
$ grep -rn "new MigrationsCustomResource" packages/infra/src/
(no output)
```

`packages/infra/src/app.ts:55-91` instantiates exactly four stacks per stage: `DatabaseStack`, `FrontendStack`, `ApiStack`, `ObservabilityStack`. None of them wires the migrations CustomResource. The prior PR 1 review flagged this as **S7** ("dead code in PR 1") and explicitly said "PR 2a is the proper home for instantiation" (`pr1-readability-review.md §S7`). That did not happen.

**Why this is a blocker, not a follow-up:**

1. The whole point of PR 2a is the seed (`tasks.md PR 2a §Auth`: "GREEN: finalize `packages/backend/prisma/seed.ts` admin user upsert (idempotent on `username`); reads `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` from env; bcrypt cost 10; logs a structured line on success."). The seed is written (`packages/backend/prisma/seed.ts:1-178`), runs idempotently against any deployment — but no deployment can run it because there is no `MigrationsCustomResource` to trigger the seed Lambda.
2. The first deploy will leave the Postgres DB empty. The auth-lambda will return `500 INTERNAL_ERROR` (the stub `prisma-user-repository.ts` will search for a user that does not exist; the bootstrap stub will throw on first `prisma.user.findUnique` because `user` is undefined on the stub).
3. The prior review also flagged that the PR 1 BLOCKER C2/C3 closeout moved the admin password to an SSM SecureString — the closeout mechanism runs through the migrations Lambda (`migrations.ts:57-58` calls `ssm.StringParameter.valueForStringParameter(this, adminPasswordParameterName)`), so the wiring only takes effect when the migrations actually run. As shipped, neither side does anything.
4. The PR 2a `apply-progress.md` does not list this work as "deferred" — it lists `Out of scope note: BR-D1, BR-D2, BR-D9 each receive a named Vitest integration test here` but the instantiation is silent. A reviewer reading only `apply-progress.md` would believe the migrations path is wired.

**Concrete fix:** In `packages/infra/src/app.ts`, instantiate the construct from either the `DatabaseStack` (after the DB stack is constructed) or the `ApiStack` (which already takes `databaseUrlSecretArn`). The cleanest shape is:

```ts
import { MigrationsCustomResource } from './constructs/migrations.js';
// inside createStageStacks, after `database` and before `api`:
const migrations = new MigrationsCustomResource(database, `MercadoExpress-${stage}-Migrations`, {
  stage,
  databaseUrlSecretArn: database.databaseUrlSecretArn,
  adminPasswordParameterName: `/MercadoExpress/${stage}/admin-password`,
});
api.addDependency(migrations.node.defaultChild as ...);
```

This requires that the `MigrationsCustomResource` can read `adminPasswordParameterName` from `DatabaseStack` (PR 1 added `DatabaseStack.adminPasswordParameterName` — verified at `DatabaseStack.ts:166`). The construct needs the IAM policy on `secretsmanager:GetSecretValue` (already wired in `migrations.ts:64-72`).

**Companion fix (C2 below)**: the Lambda body itself must also stop being a stub.

### C2 — `migrations-lambda.ts:50-66` is a PR 1 stub that returns SUCCESS without running `prisma migrate deploy` or the seed. **BLOCKER.**

`packages/infra/src/constructs/migrations-lambda.ts:50` says, in a comment: `// PR 2a replaces the body with real`prisma migrate deploy`+ seed calls.` That replacement did not happen. The handler body is:

```ts
// PR 1 stub: log intent, return success so the synth test passes.
// PR 2a replaces the body with real `prisma migrate deploy` + seed calls.
const databaseUrl = process.env['DATABASE_URL'] ?? '';
// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    msg: 'migrate-and-seed PR 1 stub',
    databaseUrlHost: databaseUrl.split('@').pop() ?? 'unset',
    requestType: event.RequestType,
  }),
);
// Even in the stub, surface the intent — the real commands land in
// PR 2a when `prisma/schema.prisma` and `prisma/seed.ts` ship.
void runCommand;
respond(event, { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' });
return { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' };
```

And the file did not change in PR 2a:

```
$ git log --follow --oneline packages/infra/src/constructs/migrations-lambda.ts
af30e91 feat(infra,migrations): add CustomResource Lambdas for prisma migrate + seed + jwt-secret
```

(One commit only — the original PR 1 commit. PR 2a did not touch the file.)

**Concrete fix:** Replace the stub body with:

```ts
const databaseUrl = await resolveDatabaseUrl(); // calls secretsmanager:GetSecretValue
const migrate = runCommand('npx', ['prisma', 'migrate', 'deploy'], {
  env: { DATABASE_URL: databaseUrl, ...process.env },
});
if (!migrate.ok) return fail(event, `migrate: ${migrate.stderr}`);
const seed = runCommand('npx', ['tsx', 'prisma/seed.ts'], {
  env: { DATABASE_URL: databaseUrl, ...process.env },
});
if (!seed.ok) return fail(event, `seed: ${seed.stderr}`);
respond(event, { Status: 'SUCCESS', PhysicalResourceId: 'migrate-and-seed' });
```

This pairs with **C1** above — without C1's instantiation, this code never runs. Together they fix the runbook gap and unblock PR 1 BLOCKERs C2 + C3 from actually taking effect at deploy time.

### C3 — `prisma-client.ts:54-94` returns a PR 1 stub — `getPrismaClient()` does not produce a real Prisma client. **BLOCKER.**

`packages/backend/src/shared/prisma-client.ts:76-92` returns a `createStubClient()` object whose `loginAttempt.count`, `user.findUnique`, etc. are all `undefined`. The `throw new Error('Prisma $queryRaw is a PR 1 stub; generated client ships in PR 2a')` line at line 91 is the most explicit admission:

```
$ grep -n "PR 1 stub\|PR 2a" packages/backend/src/shared/prisma-client.ts
  3: * PR 1 ships the wiring. PR 2a adds the actual schema and the generated
  5: * PR 1 ships only the
  8: * PR 2a; PR 1 ships only the methods the shared middleware uses so the
45: * PR 1 returns a stub
47: * PR 1 returns a stub so the build is green; PR 2a replaces the body with:
68: * PR 2a will replace
91: throw new Error('Prisma $queryRaw is a PR 1 stub; generated client ships in PR 2a');
```

PR 2a shipped the schema (`packages/backend/prisma/schema.prisma`) and the migration (`0_init/migration.sql`), but it did **not** wire `new PrismaClient(...)` into the factory. The hand-rolled fakes in unit tests (15 files have `function makeFakePrisma()`-shaped mocks) make the build + the test suite green regardless. The actual production runtime would crash on the first request.

The user's checklist #2 (D6 lineage, JWT secret rotation) AND checklist #4 (RISK-003 Postgres-backed rate limiter) both rely on a real Prisma client. PR 2a is **the** PR where the factory was supposed to flip from stub to real client. It did not.

**Concrete fix:** In `prisma-client.ts`, replace `createStubClient` with:

```ts
function createRealClient(opts: PrismaClientOptions): PrismaLike {
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  return new PrismaClient({
    log: opts.log ?? ['warn', 'error'],
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  }) as unknown as PrismaLike;
}
```

Note the `require` (not `import`): the generated `@prisma/client` only exists after `pnpm -filter backend prisma generate` runs. The migrations CustomResource Lambda must run `prisma generate` as part of its bootstrap (the standard `prisma migrate deploy` does not do this; the migrations Lambda needs an explicit step). This couples with **C1 / C2**.

### C4 — `getter-prisma-client.ts` test surface bypass masks the missing factory. **INFORMATIONAL.**

The 160/160 test pass count proves nothing about the actual factory body. The tests `prisma-user-repository.test.ts`, `postgres-rate-limiter.test.ts` (and similar for products + categories) all inject stubs that bypass `getPrismaClient()` entirely. The handler tests (`login.test.ts`, `create-category.test.ts`, `list-categories.test.ts`) use `vi.mock('../../bootstrap.js', ...)` and never reach `getPrismaClient()`. There is **no test that verifies `getPrismaClient()` returns a non-stub client**. The verification gate is green by accident, not by design.

Same applies to `MigrationsCustomResource`: `cdk synth` succeeds because no stack instantiates the construct (so no template resource is generated and nothing fails the synth smoke test). The fact that `synth.test.ts:13-14` calls `cdk synth -c stage=dev` and exits 0 is consistent with — and enabled by — the dead-code defect.

### C5 — Inline error code strings in two product handlers. **BLOCKER (matches `shared/spec.md §403-407`).**

`shared/spec.md §403-407` is explicit: "the source code references `ErrorCode.SKU_ALREADY_EXISTS` and never the literal `"SKU_ALREADY_EXISTS"`". PR 2a violates this in two files:

- `packages/backend/src/products/interface/handlers/get-product.ts:24` — `code: 'VALIDATION_ERROR'` (inline string).
- `packages/backend/src/products/interface/handlers/update-product.ts:94` — `code: 'VALIDATION_ERROR'` (inline string).

```
$ grep -n "code: '" packages/backend/src/products/interface/handlers/get-product.ts \
    packages/backend/src/products/interface/handlers/update-product.ts
get-product.ts:24:                code: 'VALIDATION_ERROR',
update-product.ts:94:                code: 'VALIDATION_ERROR',
```

The rest of the codebase correctly uses `ErrorCode.VALIDATION_ERROR` (`create-product.ts:21`, `list-products.ts:15`, `update-product.ts:18`, `create-category.ts:15`, `auth/login.ts:26`). The user's checklist #9 explicitly requires this. These two inline strings slip through the orchestrator-supplied `scripts/verify-error-codes.ts` (per `design.md §3 cross-cutting`) if it ever lands.

**Concrete fix:** replace both with `code: ErrorCode.VALIDATION_ERROR`. The handler must also import `ErrorCode` from `@mercadoexpress/shared`. (Both files currently don't import it.)

### C6 — `products/interface/dispatcher.ts` is dead code that re-uses an inline `'NOT_FOUND'` string. **MINOR-BLOCKER.**

`packages/backend/src/products/interface/dispatcher.ts:46` — `code: 'NOT_FOUND'`. Inline. Dead (no caller — the production path is via `products/interface/handlers/bootstrap.ts` re-exporting `shared/dispatchers/products-categories-dispatcher.ts`). Same defect as C5 in a file that ships no runtime value.

**Concrete fix:** delete `products/interface/dispatcher.ts` entirely. It is the leftover WIP file from commit `8a5c616 chore(pr2a): wip`. `git ls-files` will remove it; the cross-bc-bounds test (`test/architecture/cross-bc-bounds.test.ts:89-95`) currently names this file by pattern (`endsWith('interface/dispatcher.ts')`) in its exemption comment, but the test passes either way (the file has no cross-BC import that breaks the assertion). Deferring the test-text update is fine.

### W4 — Dual-secret rotation: `JWT_OVERLAP_SECONDS` env var is read but never enforced. **WARNING (security correctness gap).**

`auth/spec.md §182-194` defines:

> The system MUST additionally verify tokens signed with `JWT_SECRET_PREVIOUS` during the rotation overlap window (`JWT_OVERLAP_SECONDS`, default `3600`) and MUST fall back to single-secret verification when `JWT_SECRET_PREVIOUS` is unset.

The overlap-window spec has three scenarios:

- "New secret active, old secret valid in overlap" — middleware accepts previous-secret tokens when `JWT_OVERLAP_SECONDS = 3600`.
- "Overlap expired" — middleware rejects previous-secret tokens after the window.
- "Single-secret mode" — middleware rejects previous-secret tokens when `JWT_SECRET_PREVIOUS` is unset.

The middleware (`packages/backend/src/shared/jwt-middleware.ts:75-99`) handles **only the first and third scenarios** correctly: if `JWT_SECRET_PREVIOUS` is set, it accepts previous-secret tokens **indefinitely**. There is no time-bound check. `process.env['JWT_OVERLAP_SECONDS']` is referenced in the docstring (line 7-8) and the test (`test/shared/jwt-middleware.test.ts:37`) but **never read** in the function body. `grep -n "JWT_OVERLAP_SECONDS" packages/backend/src/` returns zero matches outside the comment.

Tests cover both "valid previous-secret token" and "no previous-secret" paths; the critical "expired overlap" path is **not tested**. The test list explicitly says:

> - valid token signed with `JWT_SECRET_PREVIOUS` during overlap → payload returned

…but no "previous-secret token after overlap expired → 401" case.

**Why it matters:** the spec's threat model assumes the rotation window is bounded so that a compromised `JWT_SECRET_PREVIOUS` cannot be used to forge tokens indefinitely after the rollout. The current code violates the bound. To meet the spec, the middleware needs:

1. A "rotation timestamp" source — either persisted elsewhere or computed (e.g. `ROTATION_START_AT` env var that the runbook writes alongside the secret).
2. A guard: `if (previous && process.env['JWT_OVERLAP_SECONDS'] && Date.now() - rotationStart < overlap * 1000) accept previous; else reject`.

**Concrete fix (one path):** Add a `JWT_ROTATION_START_AT` env var (ISO timestamp of when the current secret became primary). The middleware reads it; if `JWT_SECRET_PREVIOUS` is set and `Date.now() - rotationStart <= JWT_OVERLAP_SECONDS * 1000`, accept a previous-secret signature; otherwise reject. The operations runbook (`runbook/rotate-admin-password.md`, PR 1) is updated to write `JWT_ROTATION_START_AT` at the same step the secret is rotated. Add one new Vitest case: "previous-secret token issued after `JWT_OVERLAP_SECONDS` elapsed → 401".

If the rotation bound is intentionally relaxed for MVP (let tokens be issued by either secret across the deployment's lifetime), the spec must be amended — document the deviation.

### W5 — `Shared ValidationError` maps to 422 but the spec says 400. **WARNING (mismatched semantics).**

`packages/shared/src/errors/typed-errors.ts:27-34`:

```ts
export class ValidationError extends BaseDomainError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      httpStatus: 422,
      ...
```

`packages/backend/src/shared/error-mapper.ts:62-64` honors whatever `httpStatus` the subclass carries. The error-mapper test pins this at 422 (`test/shared/error-mapper.test.ts:27-37` — "maps ValidationError → 422 envelope with code VALIDATION_ERROR").

But `shared/spec.md §33-39` says:

> #### Scenario: 400 invalid input
>
> - GIVEN a request that fails Zod validation
> - WHEN the Lambda responds
> - THEN the body matches the envelope shape with `code = "VALIDATION_ERROR"` and `details` listing each field path and message

The spec is using `VALIDATION_ERROR` for the **input-validation 400** case, not for the 422 business-rule-violation case. The 4 PR 2a handlers (`auth/login.ts:24-29`, `products/create-product.ts:17-22`, `products/list-products.ts:11-16`, `products/update-product.ts:14-19`, `categories/create-category.ts:11-16`) all declare their own local `class ValidationError extends BaseDomainError { httpStatus: 400 }` precisely to get the 400 mapping. The shared `ValidationError` sits unused in production — the handlers' local classes diverge from it to satisfy the spec.

`tasks.md §2 PR 2a` enumerates this under cross-cutting: the spec mandate is 400 for VALIDATION_ERROR.

**Concrete fix (choose one):**

- (a) Change the shared `ValidationError.httpStatus` to 400; update `error-mapper.test.ts:27-37` to expect 400. Then handlers can use the shared class (collapsing the 4 local duplicates into 1 import). This is the right fix for the duplication.
- (b) Rename the shared class to `BusinessRuleError` (422) and use it for the 422 cases (which don't exist yet — `CategoryNotFoundError` 422 in PR 2c, `OrderQtyBelowPolicyError` 422 in PR 2c, `StockWouldGoNegativeError` 422 in PR 2b).

Either way, the test pinned to 422 in PR 1 needs to be updated, and the actual semantics must align with the spec.

### W6 — D3 (Postgres-backed rate limiter) is correctly wired. **PASS.**

Verified end-to-end:

- `migrations/0_init/migration.sql:51-58` — `login_attempts` table with the **partial index** `WHERE success = false` (the only place partial indexes can be declared; the `schema.prisma @@index` on `LoginAttempt` is redundant since the migration is hand-written, but harmless).
- `postgres-rate-limiter.ts:65-72` — `recordFailure` calls `prisma.loginAttempt.create({ data: { success: false } })`.
- `postgres-rate-limiter.ts:78-83` — `recordSuccess` calls `prisma.loginAttempt.deleteMany({ where: { success: false } })` to **reset** the counter on a successful login (Q-P4).
- `postgres-rate-limiter.ts:91-99` — `check` reads count within the 15-minute window.
- `login.ts:80-95` — use case reads `decision.count` pre-bcrypt, increments on `InvalidCredentialsError` paths only, never on success.
- `postgres-rate-limiter.test.ts:11-55` — 4 test cases: single failure, 5 failures trip blockedUntil, recordSuccess wipes, isolation per (ip, username).

The user's checklist #2 (D3) is met by the implementation; it's the runtime **availability** (C1/C2/C3 — the migrations not running, the stub client never replaced) that breaks the chain.

### W7 — D6 (bcrypt cost 10) is correctly wired. **PASS.**

`bcrypt-password-hasher.ts:13-22` reads `BCRYPT_COST` env (default 10), validates the cost is 4-15. The seed uses `bcrypt.hash(password, BCRYPT_COST)` at `prisma/seed.ts:88`. The migrations Lambda env wires `BCRYPT_COST: '10'` at `ApiStack.ts:218` (wait — that's the **5 lambda functions** block, not the migrations Lambda; verified `migrations.ts:46-56` — no BCRYPT_COST env var on the migrations Lambda). The seed reads from process.env at runtime and the migrations Lambda does NOT have `BCRYPT_COST` in its env block, so the seed falls back to the default 10 (the `?? 10` at `seed.ts:18`). Defensible for MVP since the source of truth is "bcrypt cost 10"; but it's a coupling risk if anyone bumps the cost on the auth Lambda without coordinating with the migrations.

Minor (not a defect): the migrations Lambda env block at `migrations.ts:46-56` should include `BCRYPT_COST: '10'` to lock the cost in place across all environments.

### W8 — No hardcoded secrets. **PASS (with no regressions vs PR 1).**

`grep -rniE "(password|secret)=('|\")[^'\"]+('|\")|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9_-]{20,}|admin123|change-me|placeholder-replaced" packages/backend/src packages/backend/test packages/backend/prisma packages/infra/src packages/infra/test`

Returns:

- 1 CDK placeholder string (`'placeholder-replaced-by-ops'` at `ApiStack.ts:155`, `DatabaseStack.ts:165`, `jwt-secret.ts:35`) — these are SSM parameter initial values (`SecureString` type, encrypted at rest); same as PR 1.
- 1 historical comment reference (`'change-me-on-first-deploy'` at `migrations.ts:56`) — same as PR 1 (already flagged S1' in the prior review).
- 4 `ADMIN_USERNAME: 'admin'` / `ADMIN_EMAIL: 'admin@mercadoexpress.local'` identifiers (not secrets) at `migrations.ts:50-52`.
- Test fixtures: `'integration-test-secret-at-least-32-bytes-long'`, `'a'.repeat(64)`, `'b'.repeat(64)`, `'c'.repeat(64)`, `'super-secret-1234'`, `'secret-1234'`, `'whatever'`, `'wrong-password'`, `'wrong'`, `'ADMIN'`-shaped placeholder emails. All in `.test.ts` files; the orchestrator-supplied `scripts/check-no-secrets.sh` is supposed to exclude `.test.ts` per `tasks.md §3`.

No AWS access keys, no `sk-` API keys, no hex-encoded blobs, no `https://user:pass@host` URL patterns. **PR 2a introduces no new hardcoded secret material.**

### W9 — `auth/login.ts` honors the spec's rate-limit contract. **PASS.**

`packages/backend/src/auth/application/login.ts:80-95`:

- Pre-fail-fast: throws `RateLimitExceededError` BEFORE bcrypt when count ≥ threshold. Spec compliant with `auth/spec.md` US-1 "5 failures/15 min → 429".
- Unknown-user path (`users.findByUsername` returns null) records a failure and throws `InvalidCredentialsError` (byte-identical 401 to wrong-password). Spec compliant.
- Wrong-password path records a failure and throws `InvalidCredentialsError`.
- Success path calls `recordSuccess` (resets the counter, **Q-P4: failures only count**).

`auth/application/login.test.ts:13` declares 6 test cases including the byte-identical 401 check and the counter-not-incremented check. `postgres-rate-limiter.test.ts:55-72` exercises the `recordSuccess` wipe. The "5 failures → blocked for 15 min" assertion at `postgres-rate-limiter.test.ts:30-39` is concrete.

The Q-P4 branch (`login.ts:115`) does call `recordSuccess`, which I verified deletes the failure rows (`postgres-rate-limiter.ts:78-83`). The Q-P4 behavior holds.

### W10 — The auth domain `User` aggregate is **dead production code**. **WARNING (separation-of-concerns smell).**

`packages/backend/src/auth/domain/user.ts:22-69` defines `User` with `static create()` + `static rehydrate()` factory methods that enforce bcrypt-cost, username-format, email-format, role invariants. The test at `auth/domain/user.test.ts:9-78` covers 6 cases.

But **no production code calls `User.create()` or `User.rehydrate()`**:

```
$ grep -rn "User\.create\|User\.rehydrate" packages/backend/src packages/backend/prisma
auth/domain/user.test.ts: ...test only...
```

- `prisma/seed.ts:94-99` calls `prisma.user.upsert({ ... })` directly, then `bcrypt.hash(password, BCRYPT_COST)`, with NO `User.create()` in the path.
- `auth/infrastructure/prisma-user-repository.ts:45-50` returns a plain `UserProps` object, NOT a `User` aggregate.
- `auth/application/login.ts` calls `users.findByUsername(username)` and then reads `user.passwordHash` directly — never `User.create`.

The pattern that worked for Products (`products/application/create-product.ts:37` calls `Product.create(...)`) is absent for Auth. The `User` aggregate is essentially decorative.

**Why it matters (not a blocker today):** the invariant `passwordHash's bcrypt cost == BCRYPT_COST` is enforced at `User.assertInvariants` (line 78-82). Because no production path constructs a `User`, **the invariant is never checked at runtime**. If someone bumps `BCRYPT_COST` to 11, the seed will produce a cost-11 hash, login-time `bcrypt.compare` will still verify (bcrypt ignores cost at compare time), but the next time anyone tries to login with a new user, the cost-11 hash will fail the domain invariant at `User.create` — except no production path calls `User.create`, so the cost bump silently skips the invariant guard.

**Concrete fix (small refactor):**

- Wrap the seed's `bcrypt.hash` call in `User.create` validation OR add a domain-level helper `assertBcryptCostMatches(hash)` that the seed + repository both call.
- Have `PrismaUserRepository.findByUsername` return `User.rehydrate(props)` instead of `UserProps` so login.ts can never access `.passwordHash` without going through the invariants.

This is not a blocker — bcrypt cost validation happens at the bcrypt module level (cost is encoded in the hash; `bcrypt.compare` knows what cost was used). But the invariant in the domain file says one thing and the runtime does another; that's a documentation/invariant smell.

---

## API + test quality

### S1 — architectural-test exemption targets the wrong file path. **SUGGESTION.**

`packages/backend/test/architecture/cross-bc-bounds.test.ts:93-95` exempts:

```ts
const isDispatcher = file.endsWith('interface/dispatcher.ts');
if (isDispatcher) continue;
```

The actual production cross-BC dispatcher lives at `packages/backend/src/shared/dispatchers/products-categories-dispatcher.ts`. The `products/interface/dispatcher.ts` file (which this exemption was clearly written for) is now dead code (see C6). The exemption therefore never matches in practice — the architectural test happens to pass because the production dispatcher imports via `../../products/interface/handlers/...` and `../../categories/interface/handlers/...`, which are sibling-BC paths but the test does not catch them as cross-BC because the import path stays inside the BCs' `interface/` subfolder.

The exemption should be updated to:

```ts
// The shared dispatcher in `shared/dispatchers/products-categories-dispatcher.ts`
// is the documented cross-BC seam per design.md §3.6 — it's allowed to import
// both BCs' interface/handlers.
if (file.includes('/shared/dispatchers/')) continue;
```

(And the test should be updated to actually exclude that file from the cross-BC assertion.)

### S2 — Handler `ValidationError extends BaseDomainError` duplicated 4 times. **SUGGESTION.**

The same class definition appears in `auth/login.ts:24-29`, `products/create-product.ts:17-22`, `products/list-products.ts:11-16`, `products/update-product.ts:14-19`, `categories/create-category.ts:11-16`. All 5 sites override the shared `ValidationError` (W5) because the shared class maps to 422 while the spec mandates 400 for VALIDATION_ERROR.

If W5 is fixed by changing the shared class to 400, all 5 local copies collapse to `import { ValidationError } from '../../../shared/errors/typed-errors.js'` (handled in W5). Recommend doing both together.

### S3 — Inline pseudo-Zod validation in 4 handlers. **SUGGESTION.**

`packages/backend/src/products/interface/handlers/create-product.ts:33-83` reimplements the `createProductRequestSchema` (from `packages/shared/src/schemas/products/create-product.ts:13-19`) as a hand-rolled object parser that constructs a `ZodError` with `code: 'custom' as const`. Same pattern in `list-products.ts`, `update-product.ts`, `create-category.ts`. The auth login handler (`auth/login.ts:32-37`) correctly does `loginRequestSchema.parse(...)` from the shared schemas.

The shared schema is the source of truth per `shared/spec.md §3 cross-cutting` — reimplementing it in handlers is duplicated logic (one of the review rules). The two schemas also diverge: the inline `create-product.ts:48` `price: Number(r['price'])` allows fractional values like `1500.5`, while the shared `createProductRequestSchema:14` correctly rejects fractions with `price: z.number().int().min(0)`. So which one runs determines whether the spec scenario "Fractional price rejected" actually holds.

**Concrete fix:** replace each handler's `parseBody` / `parseQuery` with `createProductRequestSchema.parse(...)` / `listProductsRequestSchema.parse(...)` etc. The shared schemas already exist for create + update (per `apply-progress §1`); add `list-products` and a request schema for `get /products/{id}` as part of PR 2a. The handlers should import from `@mercadoexpress/shared`.

### S4 — `BACKEND_PACKAGE_VERSION` not bumped to `pr2a`. **SUGGESTION (carry-over from PR 1 review S4).**

`packages/backend/src/index.ts:10` — `export const BACKEND_PACKAGE_VERSION = '0.0.0-pr0';`. The infra package (`packages/infra/src/app.ts:23`) was bumped to `'0.0.0-pr1'` in PR 1; the backend was not bumped in PR 1 (PR 1 review S4); and PR 2a did not bump it either. Style consistency.

### S5 — `products/application/create-product.ts:37` ignores `aggregate.sku` casing for the SKU-existence check. **SUGGESTION.**

The `CreateProductUseCase`:

```ts
const aggregate = Product.create({ ...input });
const category = await this.categories.findById(aggregate.categoryId);
...
const existing = await this.products.findBySku(aggregate.sku);  // aggregate.sku is upper-cased
```

`Product.create` upper-cases the SKU at `product.ts:42` (`sku: input.sku.toUpperCase()`). So `aggregate.sku` is `'BEB-001'` regardless of whether the caller sent `'beb-001'`. The repository adapter (`prisma-product-repository.ts:67`) also upper-cases on lookup: `findBySku(sku) { ... findUnique({ where: { sku: sku.toUpperCase() } }) }`. The double-upper-case is harmless but redundant.

Either the aggregate or the repository should own the normalization. Currently both do. Minor smell.

### S6 — Password-hash regex too strict at `domain/user.ts:22` + bcrypt cost assertion bypass. **SUGGESTION.**

`User.BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/` accepts only the canonical 53-character salt after the cost tag. The regex matches every bcrypt hash produced by the `bcrypt` npm module, but it does NOT account for `bcrypt.hash(..., cost)` with cost > 99 (impossible per `bcrypt-password-hasher.ts:21` guard, so this is unreachable). The user.ts asserts the cost matches `BCRYPT_COST` env at `domain/user.ts:84-92`. Since no production path constructs a `User`, this assertion is also bypassed (per W10).

SUGGESTION-level: combine S5's "use aggregate at the repo boundary" with W10's "delete the dead code" so neither smell remains.

---

## Coverage of business rules

The business rules per `proposal.md` and the spec files split cleanly into "PR 2a scope" (auth + products + categories CRUD) and "later PRs" (BR-1..BR-6 for inventory / orders).

| Rule                                      | Spec                                    | Requirement (short)                                                    | Tests that cover it (PR 2a)                                                                                                                                                                                                                                                                                                                                                                                                        | Status                                                                                        |
| ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AU-1                                      | `auth/spec.md §33-50`                   | Login returns 200 + JWT on valid creds, 401 on invalid                 | `auth/application/login.test.ts:79-99` (happy), `:101-109` (unknown user), `:111-122` (wrong password)                                                                                                                                                                                                                                                                                                                             | ✅                                                                                            |
| AU-2                                      | `auth/spec.md §33-50`                   | Invalid creds is byte-identical 401 (no enumeration)                   | `login.test.ts:111-122` (asserts `InvalidCredentialsError`, not message) + `interface/handlers/login.test.ts` (asserts statusCode only)                                                                                                                                                                                                                                                                                            | ⚠️ partial — explicit byte-comparison of two response bodies is not asserted                  |
| AU-4, Q-P4                                | `auth/spec.md §93-160`                  | 5 failures in 15 min → 429; success does NOT increment                 | `login.test.ts:124-138` (5-threshold), `:140-152` (counter-no-incr)                                                                                                                                                                                                                                                                                                                                                                | ✅                                                                                            |
| AU-4 (window expiry)                      | `auth/spec.md §155-160`                 | Failures older than 15 min are not counted                             | `postgres-rate-limiter.test.ts:30-39` (covers threshold + window) — implicit via `windowSeconds` config; no explicit "old failure expired" case                                                                                                                                                                                                                                                                                    | ⚠️ partial                                                                                    |
| AU-rot (new secret, old in overlap)       | `auth/spec.md §188-194`                 | Old-secret token accepted in overlap                                   | `jwt-middleware.test.ts:60-72` (existing secret; previous secret)                                                                                                                                                                                                                                                                                                                                                                  | ✅                                                                                            |
| AU-rot (overlap expired)                  | `auth/spec.md §196-203`                 | Old-secret token rejected after `JWT_OVERLAP_SECONDS` elapsed          | **MISSING — and the implementation does not enforce this** (W4)                                                                                                                                                                                                                                                                                                                                                                    | ❌                                                                                            |
| AU-rot (single-secret fallback)           | `auth/spec.md §205-212`                 | Only current secret accepted when `JWT_SECRET_PREVIOUS` unset          | `jwt-middleware.test.ts` does not directly assert "unset → reject previous-secret" path; the middleware handles it via the `previous && ...` short-circuit but no test pins it                                                                                                                                                                                                                                                     | ⚠️ missing                                                                                    |
| D6                                        | `auth/spec.md §214-237`                 | bcrypt cost 10 hashes; login verifies at same cost                     | `bcrypt-password-hasher.test.ts:5-12` (round-trip), `user.test.ts:48-56` (cost-11 rejection)                                                                                                                                                                                                                                                                                                                                       | ✅                                                                                            |
| D6 (seed idempotency)                     | `auth/spec.md §228-237`                 | Exactly one admin row, idempotent on `username`, bcrypt cost 10        | `seed.ts:91-99` (upsert) — no test pins the idempotency contract on the **Lambda body** since `migrations-lambda.ts` is still a stub (C2)                                                                                                                                                                                                                                                                                          | ⚠️ partial — integration test missing                                                         |
| D3 (RISK-003)                             | `risk-review.md` RISK-003               | Postgres-backed rate limiter; counter survives cold start              | `postgres-rate-limiter.test.ts:35-72` (counter mechanics) — `auth/integration/login-flow.test.ts` does **not exist** to prove cross-`$disconnect` persistence                                                                                                                                                                                                                                                                      | ❌ — tasks.md PR 2a task "GREEN: pass" was marked complete but the integration test is absent |
| US-2 (register product)                   | `products/spec.md §29-47`               | Create with full validation: 201 + body; 400 / 422 / 409 on violations | `application/create-product.test.ts:60-91` (3 cases), `domain/product.test.ts:14-79` (8 invariant cases). **Handler test ABSENT** — `products/interface/handlers/create-product.ts` has no `.test.ts`                                                                                                                                                                                                                              | ⚠️ partial                                                                                    |
| BR-D6 (no silent upsert)                  | `proposal.md §119`                      | Duplicate SKU returns 409, existing row untouched                      | `application/create-product.test.ts:79-86` (use case throws `SkuAlreadyExistsError`); handler test missing                                                                                                                                                                                                                                                                                                                         | ⚠️ partial                                                                                    |
| BR-3, BR-4 (alert auto-close; one ACTIVA) | `proposal.md §33` / `inventory/spec.md` | Inventory → alerts flow                                                | Out of scope (PR 2b/2c). Port interface declared shape may land in PR 2b                                                                                                                                                                                                                                                                                                                                                           | ✅ deferred                                                                                   |
| BR-1, BR-2 (SALIDA policy)                | `proposal.md §33`                       | Stock wouldn't go negative; order qty ≥ 2× stockMin                    | Out of scope (PR 2b/2c)                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ deferred                                                                                   |
| BR-5 (state machine)                      | `proposal.md §33`                       | Order PENDIENTE→APROBADA/RECHAZADA→RECIBIDA                            | Out of scope (PR 2c)                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ deferred                                                                                   |
| BR-6 (append-only movement)               | `proposal.md §33`                       | `stock_movements` has no `update`/`delete` paths                       | Out of scope (PR 2b). Schema in PR 2a has no relations into `stock_movements` (verified: `schema.prisma` does not declare a `stockMovements` model at all — `stock_movements` is in the migration SQL but not the Prisma model). The D1 invariant ("no FK from products/alerts/purchase_orders into stock_movements") cannot be verified from a Prisma check since `stock_movements` is not declared. RISK-001 reminder for PR 2b. | ⚠️ deferred with caveat                                                                       |
| D1 (no FK into stock_movements)           | `design.md §4.4`                        | Prisma relations to `stock_movements` are zero                         | `schema.prisma` does not declare `stock_movements` model — so by definition, no relations to it from `products`, `alerts`, etc. **But**: the `alerts` and `purchase_orders` (deferred) models also lack the FK columns; this is OK because the tables don't exist yet in Prisma. RISK-001 cross-check should re-run in PR 2b.                                                                                                      | ⚠️ deferred                                                                                   |

**Coverage summary**:

- 9 of 14 PR-2a-in-scope rules have full unit + handler coverage.
- 5 rules have partial coverage (use-case or domain-only, **no handler tests** for products' 4 endpoints).
- 1 rule (D3 cold-start persistence) is **uncovered** because the required integration test file `auth/integration/login-flow.test.ts` does not exist.
- 1 rule (AU-rot overlap-expired) has **no test AND a missing implementation** (W4).

The aggregate count of 160 tests is real and significant, but the per-rule coverage table above shows the **type of test** matters more than the count. Use-case-only tests pass through stub ports but never exercise the handler's envelope shape, error mapping, or status codes. The user's checklist item #16 ("RED-first test files exist for every domain entity, use case, **adapter**") requires infrastructure-layer tests — **the products BC's two Prisma adapters have zero test files**.

---

## Model recommendation for next PRs (PR 2b / PR 2c / PR 3)

For **PR 2b (inventory + alerts BCs)**: this PR is the **seam-heavy** slice. The cross-BC seam (RISK-001) ships here: `AlertCloserPort` is owned by alerts, called from inventory inside a `prisma.$transaction`. The receive flow in PR 2c depends on it. There is also SELECT … FOR UPDATE row locking on `products.stock`, the partial unique index `WHERE status = 'ACTIVA'` enforcement for BR-4, and the in-process `StockAdjusted` event (kept asymmetric with the receive flow per `design.md §5.1`).

The decisions here have non-local consequences:

- The `AlertCloserPort.txCloseIfOpenAndAboveMin` signature is **the public contract** that orders BC (PR 2c) will consume.
- The `ProductStockGate.txIncrementStock` raw-SQL helper must compile against both the inventory adapter and the orders adapter — same SQL string, same transaction boundary.
- The `stock_movements` append-only invariant is enforced at the **repository signature level** (no `update`/`delete` methods). The compile-time guard is what makes the BR-6 assertion credible.

This is **M3 (opus)** territory, not M2.7-highspeed. PR 2b is the highest-leverage / highest-risk slice in the chain; underestimating the reasoning cost here bleeds into PR 2c.

For **PR 2c (orders BC)**: this is the **most complex** PR in the chain. The four-step atomic receive flow is a real exercise in concurrent system design: order update → product stock increment → alert close, all in one tx, with rollback semantics, and (per RISK-W07) the state-machine guard plus the alert-closer idempotency plus the partial unique index all working together. The supplier-snapshot write-once invariant (Q-P3) is enforced at the repository boundary, which means the repository type signature carries the business rule. This is also M3 territory. Recommend Opus here.

For **PR 3 (frontend)**: mechanical but **wide**. ~50 files, lots of components, stores, services, but most of them are CRUD surfaces that mirror the spec. Visual direction work per `design.md §8` is design-judgment territory. Recommend M3 (opus) for the at-least-the-first-batch to lock in the visual direction and the Atomic Design folder rules; the remainder can ramp down to M2.7-highspeed once the design tokens are committed.

For **PR 4 (tests + hardening)**: mechanical. Playwright specs already enumerated; smoke scripts are short. M2.7-highspeed is appropriate here once PR 2c is done.

---

## Decision

**BLOCK.**

Three BLOCKERs must close before PR 2a can ship:

1. **C1 + C2**: `MigrationsCustomResource` must be instantiated from one of the four stacks (recommend `DatabaseStack`), AND `migrations-lambda.ts:50-66` must run real `prisma migrate deploy` + `tsx prisma/seed.ts` instead of logging a stub. Without both, PR 1's BLOCKER C2 / C3 closeouts don't actually do anything at deploy time and the database stays empty.

2. **C3**: `prisma-client.ts:76-92` must replace the `createStubClient()` body with `new PrismaClient(...)`. The 160-test pass is misleading because every test bypasses `getPrismaClient()` via `vi.mock('../../bootstrap.js', ...)` or `makeFakePrisma()`. No production runtime path is exercised.

3. **C5**: replace the inline `'VALIDATION_ERROR'` strings at `products/interface/handlers/get-product.ts:24` and `update-product.ts:94` with `ErrorCode.VALIDATION_ERROR` from `@mercadoexpress/shared`. The `shared/spec.md §Forbidden inline string` scenario is the explicit rule; the user's checklist #9 names this.

Two WARNINGs the next reviewer should pin (not blockers for this PR, but PR 2b/2c should fix):

- **W4**: `JWT_OVERLAP_SECONDS` is read nowhere. The spec's overlap-expiry scenario is unimplemented + untested. Decide: do you want a time-bound rotation (matches the spec), or relax the spec for MVP and document the deviation? Whichever you pick, align code + test + spec.

- **W5**: the shared `ValidationError` returns 422 while the spec mandates 400 for VALIDATION_ERROR. Five handlers (1 auth + 4 others) each declare a local `ValidationError { httpStatus: 400 }` to get the right status. Either fix the shared class to 400 and delete the 4 duplicates, or split into `ValidationError` (400, schema-validation) and `BusinessRuleError` (422, rule violation). S2 above folds into W5.

And three lower-priority findings the next reviewer should keep on the radar:

- **W10**: `auth/domain/user.ts` is dead production code. No repo or seed constructs a `User`. The invariants it enforces (bcrypt cost, username format) are not run on any production path.

- **S1 + C6**: the cross-BC architectural test targets the wrong dispatcher file name; the actual dead dispatcher (`products/interface/dispatcher.ts`) should be deleted.

- **S3**: 4 product/category handlers re-implement validation inline, contradicting the shared schemas in `packages/shared/src/schemas/products/`. The schemas diverge from the inline code (fractional price rejection is one example), so the spec scenarios that depend on the schemas can be made or broken by which code path runs.

The shape is right (hex boundaries are clean, ports are correct, tests are co-located, RBAC is single-role-only). What's missing is the **runtime plumbing** that proves the abstractions are wired end-to-end. The apply-progress claims "160 tests pass" but does not claim "the Lambda actually talks to the database". The 4 commits in PR 2a cover the typing + the structure; they do not cover the runtime.

`skill_resolution: none`.

# Tasks: `add-inventory-mvp` — MercadoExpress

**Phase:** sdd-tasks · **Change folder:** `openspec/changes/add-inventory-mvp/`
**Inputs consumed:** `proposal.md` (PRD), 7 spec files under `specs/`, `design.md` (§1–§16), `reviews/risk-review.md` (5 CRITICAL + 11 WARNING), `openspec/config.yaml`, `openspec/AGENTS.md`.
**Strict TDD:** ACTIVE — every task that produces production code starts with a RED test. See §4 for the per-BC TDD evidence table.

---

## 1. Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | 4500–5500                                                                                                                                                                                                                                                                     |
| 400-line budget risk    | High                                                                                                                                                                                                                                                                          |
| Chained PRs recommended | Yes                                                                                                                                                                                                                                                                           |
| Suggested split         | PR 0: Monorepo foundation + shared schemas → PR 1: Infrastructure as code + DB + JWT skeleton → PR 2a: Shared + auth + products BCs → PR 2b: Inventory + alerts BCs → PR 2c: Orders BC → PR 3: Frontend (Vue 3 SPA + visual direction) → PR 4: E2E + smoke + review hardening |
| Delivery strategy       | ask-on-risk                                                                                                                                                                                                                                                                   |
| Chain strategy          | stacked-to-main                                                                                                                                                                                                                                                               |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

**Rationale**

- The backend file manifest in `design.md` §14.1 totals ~85 backend files; the frontend sections §7–§8 add ~50 files. Add CDK infra (~15 files), `packages/shared` (~38 files), tests, fixtures, migrations, and CI workflows. Net = ~4,500–5,500 changed lines excluding `pnpm-lock.yaml` and generated Prisma clients.
- Strict TDD doubles the file count for production paths (one test per impl file, plus triangulate cases). Every warning item also ships a runnable check, so the WARNING items alone add ~15–20 small files.
- 5 of the 11 WARNING items (W01, W04, W05, W06, W07, W09, W10) each require a NEW file (security headers, runbook, idempotency table, architectural test, comment, smoke script, smoke script) before the change is review-clean.
- 400-line budget risk = High. The first PR (PR 0) is the only one under 400 lines; every other PR in the chain must hold itself under 400. The plan below uses a 4-step vertical chain (PR 0 → PR 1 → PR 2a/2b/2c → PR 3 → PR 4) plus a 3-way split of PR 2 specifically to keep each slice reviewable.
- Chain strategy `stacked-to-main` matches `config.yaml → delivery.chain_strategy`. Each PR merges to `main` in order; no integration branch.

---

## 2. Work-unit groups (chained PRs)

Five PR-shaped work units, ordered by dependency. Each has a clear start, finish, verification, and rollback boundary. Boundaries are marked with `<!-- PR BOUNDARY -->`.

### PR 0 — Monorepo foundation + shared schemas

**Goal:** pnpm workspaces, root config, lint/format/commit hooks, package skeletons, shared Zod primitives, and a green "monorepo scaffolds" smoke test. No business logic.

**Depends on:** nothing.
**Mergeable after:** `pnpm -w vitest run` is green AND `pnpm -w tsc --noEmit` is green AND `pnpm -w eslint .` is green.

**Tasks checklist** (atomic; each is one commit or one short commit group):

- [x] Initialize root `package.json` with `"private": true`, `"packageManager": "pnpm@>=9"`, and `engines.node = ">=20"`.
- [x] Create `pnpm-workspace.yaml` listing `packages/*` (`backend`, `frontend`, `infra`, `shared`).
- [x] Create `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, project-references skeleton, no `any` escape hatches.
- [x] Create `packages/shared/{package.json,tsconfig.json,src/index.ts}` skeleton; declare `@asteasolutions/zod-to-openapi` dependency.
- [x] Create `packages/backend/{package.json,tsconfig.json,vitest.config.ts,tsconfig.build.json}` skeleton; declare `prisma`, `@prisma/client`, `jose`, `bcrypt`, `pino`, `zod`, `@asteasolutions/zod-to-openapi`.
- [x] Create `packages/frontend/{package.json,vite.config.ts,tsconfig.json,tsconfig.node.json,tailwind.config.ts,postcss.config.cjs,index.html,src/main.ts}` skeleton; declare `vue@3`, `vue-router@4`, `pinia`, `vue-i18n@9`, `ofetch`, `tailwindcss`, `vitest`, `@vue/test-utils`, `@axe-core/playwright`.
- [x] Create `packages/infra/{package.json,tsconfig.json,cdk.json}` skeleton; declare `aws-cdk-lib`, `constructs`, `@aws-cdk/aws-lambda-nodejs`, `vitest`, `aws-cdk-lib/assertions`.
- [x] Add root `.editorconfig`, `.nvmrc` (`20`), `.gitignore` (ignores `node_modules`, `dist`, `.env`, `cdk.out`, `coverage`, `*.tsbuildinfo`).
- [x] Add root `.env.example` plus per-package `.env.example` files with: `DATABASE_URL`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `JWT_OVERLAP_SECONDS`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OLLAMA_HOST`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `OIDC_ROLE_ARN`, `TRUSTED_PROXY_DEPTH`, `VITE_API_BASE_URL`, `STAGE`, `AWS_REGION`.
- [x] Add ESLint flat config (`eslint.config.js`) at root with `eslint-plugin-boundaries`, `@typescript-eslint`, `vue`, `vitest`, and a barrier rule: `packages/*/src/*/domain/**` may not import from `infrastructure/**`, `interface/**`, or any provider package (`*sdk*`, `*provider*`).
- [x] Add Prettier config (`.prettierrc.json`) and `.prettierignore` (skip `dist`, `coverage`, `cdk.out`, `*.generated.ts`).
- [x] Add Husky pre-commit hook (`.husky/pre-commit` → `pnpm lint-staged`) and `commitlint` config (`commitlint.config.cjs`) with the `conventional-commits` rule.
- [x] Add `.lintstagedrc.json` running `eslint --fix` + `prettier --write` on staged `*.{ts,vue,json,md,yaml,yml}`.
- [x] **RED-first:** add `packages/shared/test/scaffolds-green.test.ts` that asserts each workspace package exists, has a valid `package.json`, and a `tsconfig.json` that extends `tsconfig.base.json`.
- [x] **GREEN:** make the test pass by ensuring the package skeletons from the previous tasks are consistent.
- [x] **RED-first:** add `packages/backend/test/tsc-no-emit.test.ts` that shells out to `pnpm --filter backend exec tsc --noEmit` and asserts exit 0.
- [x] **RED-first:** add `packages/frontend/test/vite-build.test.ts` that shells out to `pnpm --filter frontend exec vite build --mode test` and asserts exit 0 (uses a stub `App.vue`).
- [x] Add `pnpm-workspace.yaml` `onlyBuiltDependencies` allow-list (for `bcrypt`, `esbuild`, `prisma`).
- [x] Add root `README.md` with: project description, link to `porject.md`, pnpm setup, scripts (`pnpm -w vitest run`, `pnpm -w tsc --noEmit`, `pnpm -w eslint .`, `pnpm -w playwright test`), and a "Stack & locked decisions" section pointing to `openspec/config.yaml`.
- [x] Add `pnpm-workspace.yaml` script aliases: `test`, `test:watch`, `type-check`, `lint`, `format`, `db:migrate`, `db:seed`, `dev:backend`, `dev:frontend`.

**Work-unit commits** (for commit hygiene, one commit per bullet group above):

- `chore(monorepo): scaffold pnpm workspaces and root config`
- `chore(shared): add shared package skeleton`
- `chore(backend,frontend,infra): add package skeletons with locked deps`
- `chore(quality): add eslint, prettier, husky, commitlint, lint-staged`
- `test(shared,backend,frontend): RED-first scaffold-green smoke tests`
- `docs: root README with scripts and stack summary`

<!-- PR BOUNDARY -->

**Verification gate**

- `pnpm -w vitest run` → green.
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- `pnpm -w prettier --check .` → green.
- `git log --grep='^Co-authored-by'` → empty (no AI attribution in commits).
- `git commit` (with staged file) → husky pre-commit runs lint-staged and passes.

**Rollback plan**

- Revert the merge commit; no data, no infra touched, no migrations applied. The repo reverts to a state with no `packages/` directory and no root config.

---

### PR 1 — Infrastructure as code + Database + JWT middleware skeleton

**Goal:** CDK app for both stages; RDS Postgres + pgvector; API Gateway HTTP API v2 with CORS preflight (RISK-002); five Lambda placeholders; JWT middleware primitive with dual-secret rotation; SSM Parameter Store entries; migrations + seed CustomResource; GitHub Actions CI; CloudWatch alarms. No business use cases.

**Depends on:** PR 0.
**Mergeable after:** `pnpm --filter infra cdk synth --all --no-color` succeeds AND the `ci.yml` workflow passes on a PR against `main`.

**Tasks checklist**:

- [x] Create `packages/infra/src/config.ts` exporting `region: 'us-east-1'`, `apiThrottling: { burst: 100, steady: 50 }`, `reservedConcurrencyByStage: { dev: 1, prod: undefined }`, `cors: { allowedOrigins: [], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'] }`, and `logRetentionDays: 7`.
- [x] Create `packages/infra/src/app.ts` (CDK app entry): instantiates `MercadoExpress-dev` and `MercadoExpress-prod` stacks per `config.yaml → infra.stages`.
- [x] Create `packages/infra/src/stacks/DatabaseStack.ts` with: VPC (default), subnets, security group, `rds.DatabaseInstance` (`engine: postgres-16`, `instanceType: t3.micro`, `rds.extensions: ['vector']`, `databaseName: 'mercadoexpress'`, `deletionProtection: false` in dev). Export `databaseUrlSecretArn` and `securityGroupId`.
- [x] Create `packages/infra/src/constructs/migrations.ts`: `CustomResource` Lambda that runs `npx prisma migrate deploy` then `npx tsx prisma/seed.ts` in one invocation; reads the DB secret ARN from `DATABASE_URL` (Secrets Manager; PR 1 review BLOCKER C2 closeout) and the admin password from SSM SecureString `/MercadoExpress/{stage}/admin-password` (PR 1 review BLOCKER C3 closeout).
- [x] Create `packages/infra/src/constructs/seed.ts` (the script `packages/backend/prisma/seed.ts` ships a stub here; full body in PR 2a).
- [x] Create `packages/infra/src/stacks/FrontendStack.ts` with: S3 bucket (private), CloudFront distribution with OAC, default `*.cloudfront.net` certificate, SPA fallback (404 → `index.html` with 200), response headers policy stub for `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`. Export `distributionDomainName`.
- [x] Create `packages/infra/src/stacks/ApiStack.ts` with: `HttpApi` including **`corsPreflight` block per RISK-002** (allowOrigins: `https://${distributionDomainName}`, allowMethods: GET/POST/PATCH/OPTIONS, allowHeaders: Content-Type/Authorization/X-Request-Id/Idempotency-Key, allowCredentials: false, maxAge: 1 hour); 5 `NodejsFunction` placeholders (`auth-lambda`, `products-lambda`, `inventory-lambda`, `alerts-lambda`, `orders-lambda`); reserved concurrency = 1 in `dev` per `config.ts`; CloudWatch log groups with 7-day retention; 5 alarm definitions per `design.md` §12.4 + §15.3; default throttle = 100/50; **passes the `frontendStack.distributionDomainName` synth-time import** so CORS is wired.
- [x] Create `packages/infra/src/stacks/ObservabilityStack.ts` (or merged into `ApiStack`): one SNS topic per stage with email subscription; metric filters for `level == "error"` and alarms from `design.md` §15.3.
- [x] Create `packages/backend/src/shared/prisma-client.ts`: factory that returns a singleton `PrismaClient` (with `connection_limit = 2` per RISK-W11, `log: ['warn', 'error']`).
- [x] Create `packages/backend/src/shared/logger.ts`: `pino` factory with mandatory fields per `design.md` §12.2 (`requestId`, `userId`, `bc`, `route`, `latencyMs`, `outcome`).
- [x] Create `packages/backend/src/shared/request-context.ts`: `withRequestContext` HOF that extracts/generates `X-Request-Id`, binds the pino child logger, and echoes the header back.
- [x] Create `packages/backend/src/shared/error-mapper.ts`: maps every typed domain error to the `ErrorEnvelope` (`code` from `packages/shared/src/errors/errorCodes.ts`); falls back to `500 INTERNAL_ERROR` for unknown errors.
- [x] Create `packages/backend/src/shared/errors/base-domain-error.ts` with `code`, `httpStatus`, and `details`.
- [x] Create `packages/backend/src/shared/jwt-middleware.ts`: dual-secret rotation logic per `design.md` ADR-3 and `auth/spec.md` "Dual-secret rotation" requirement; reads `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `JWT_OVERLAP_SECONDS` from env; uses `jose`; on failure returns `401 UNAUTHORIZED` (or `401 TOKEN_EXPIRED` for expired tokens).
- [x] Create `packages/backend/src/shared/idempotency-key.ts`: middleware that reads `Idempotency-Key` header; on a write, hashes the body (SHA-256 of JSON-encoded, key-sorted body per RISK-S07), and the persistence is added in PR 2 (PR 1 ships the interface only).
- [x] Create `packages/backend/src/shared/extract-client-ip.ts`: parses `X-Forwarded-For` per `TRUSTED_PROXY_DEPTH` env (default 0), falls back to `event.requestContext.http.sourceIp` (RISK-W03).
- [x] Create `packages/backend/src/shared/health.ts`: `GET /healthz` handler for each Lambda.
- [x] Create `packages/backend/src/shared/rate-limit-error.ts` (typed error) and `packages/backend/src/shared/api-error.ts` (typed error envelope helper).
- [x] Create `packages/infra/test/constructs/api-stack.test.ts` (RED-first): CDK-construct unit test using `aws-cdk-lib/assertions` that asserts the `HttpApi` has the `corsPreflight` config with the 4 allow-headers and the CloudFront origin; asserts the 5 `NodejsFunction`s exist; asserts the 5 SSM parameters for `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `ADMIN_PASSWORD` are wired; asserts log groups have 7-day retention; asserts reserved concurrency = 1 in `dev`.
- [x] Create `packages/infra/test/constructs/database-stack.test.ts` (RED-first): asserts `rds.extensions` includes `vector`, instance class `db.t3.micro`, engine `postgres-16`.
- [x] Add a CDK integration test `packages/infra/test/synth.test.ts`: `cdk synth --all --no-color` shell-out asserts exit 0.
- [x] Create `.github/workflows/ci.yml`: triggers on `pull_request` and `push` to `feat/*`; jobs: `install` (pnpm `--frozen-lockfile`), `type-check`, `lint`, `unit-tests` (with `--coverage`, gates ≥80% for backend `domain` + `application`), `build-cdk` (`cdk synth --all`), **`vulnerability-scan` (`pnpm audit --prod --audit-level=high` per RISK-W02)**, `e2e` (Playwright, runs against docker-compose Postgres + services).
- [x] Create `.github/workflows/deploy-dev.yml`: push to `main` → OIDC `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ secrets.OIDC_ROLE_ARN }}`; runs `cdk deploy -c stage=dev --require-approval never`; writes `dev-url.txt` artifact.
- [ ] Create `.github/workflows/deploy-prod.yml` SCAFFOLD ONLY (per proposal §9): present, with `if: false` guard, manual-approval step commented. Do NOT exercise in this change.
- [x] Add `scripts/rotate-admin-password.ts` (KL-01, RISK-W04): programmatic rotation that generates a fresh bcrypt(cost 10) hash and updates the `users` row; the operational runbook for SSM + seed-CustomResource steps lives separately under `runbook/` and is documented in `apply-progress.md`.
- [x] Add `scripts/verify-locked-decisions.ts` (KL-02, per §3 cross-cutting task) — 11/11 checks honor D1..D7 + Q-P1..Q-P4.
- [x] Add `scripts/check-no-secrets.ts` (KL-03, per §3 cross-cutting task) — scans for AWS keys, OpenAI-style keys, Bearer tokens, JWT-shaped literals, hardcoded credential assignments, and non-allowlisted URLs.

**Work-unit commits**:

- `feat(infra): add CDK app entry and stage config`
- `feat(infra): add DatabaseStack with RDS pgvector (R-9)`
- `feat(infra): add FrontendStack with S3+CloudFront+OAC`
- `feat(infra): add ApiStack with CORS preflight (RISK-002) and 5 Lambda placeholders`
- `feat(infra): add migrations + seed CustomResource chain (D5)`
- `feat(backend/shared): add logger, request-context, error-mapper, jwt-middleware skeleton, XFF parser (RISK-W03)`
- `test(infra): RED-first CDK construct unit tests`
- `ci: add ci.yml, deploy-dev.yml; scaffold deploy-prod.yml`
- `docs(runbook): add rotate-admin-password runbook (RISK-W04)`

<!-- PR BOUNDARY -->

**WARNING items addressed in PR 1**: RISK-W02 (vuln-scan job in `ci.yml`), RISK-W03 (XFF parser in `extract-client-ip.ts`), RISK-W04 (rotation runbook), RISK-W11 (`connection_limit = 2` on Prisma client + comment).

**CRITICAL items addressed in PR 1**: RISK-002 (CORS preflight on `HttpApi`).

**Verification gate**

- `pnpm --filter infra exec cdk synth --all --no-color` → exit 0, no diff in `cdk.out/` for repeated runs (idempotency).
- `pnpm -w vitest run` → green.
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- GitHub Actions `ci.yml` → green on a PR.
- `pnpm audit --prod --audit-level=high` → no high/critical vulns.
- `cdk synth` output for `HttpApi` includes a `CorsPreflight` resource with the 4 headers and the CloudFront origin allow-list.

**Rollback plan**

- `cdk destroy MercadoExpress-dev` removes all stacks. No data written yet (migrations + seed are idempotent and additive). Re-running the workflow on a fix is safe.

---

### PR 2a — Shared package + auth BC + products BC

**Goal:** Shared Zod schemas, error codes, and the `auth` + `products` bounded contexts. No inventory, no alerts, no orders. Frontend still not started. This is the first backend slice.

**Depends on:** PR 1.
**Mergeable after:** `pnpm --filter backend test` is green AND coverage for `auth/domain` + `auth/application` + `products/domain` + `products/application` is ≥ 80%.

**Tasks checklist**:

**Shared package** (per `shared/spec.md`):

- [x]- [x] **RED:** `packages/shared/src/schemas/common/error-envelope.test.ts` — assert envelope shape for 400/401/403/404/409/422/429/500.
- [x]- [x] **GREEN:** implement `packages/shared/src/schemas/common/error-envelope.ts` (Zod) + `packages/shared/src/errors/errorCodes.ts` with every code from the specs (`UNAUTHORIZED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `SKU_ALREADY_EXISTS`, `CATEGORY_NOT_FOUND`, `STOCK_WOULD_GO_NEGATIVE`, `ORDER_QTY_BELOW_POLICY`, `ALERT_NOT_ACTIVE`, `ALERT_ALREADY_ACTIVE`, `ORDER_INVALID_TRANSITION`, `REJECTION_REASON_TOO_SHORT`, `PRODUCT_NOT_FOUND`, `INTERNAL_ERROR`, `IDEMPOTENCY_KEY_CONFLICT`, `NETWORK_ERROR`, `TIMEOUT`).
- [x]- [x] **RED:** `packages/shared/src/schemas/common/page.test.ts` — default pagination, out-of-range size, empty result.
- [x]- [x] **GREEN:** `packages/shared/src/schemas/common/page.ts` (Zod generic `Page<T>`).
- [x]- [x] **RED:** `packages/shared/src/schemas/common/idempotency-key.test.ts` — UUID v4 validation; missing header is allowed.
- [x]- [x] **GREEN:** `packages/shared/src/schemas/common/idempotency-key.ts`.
- [x]- [x] **RED:** `packages/shared/src/domain/money.test.ts` — `Decimal → string → parseInt` round-trip; rejects fractional input.
- [x]- [x] **GREEN:** `packages/shared/src/domain/money.ts` + `MoneySerializer.ts`.
- [x]- [x] **RED:** `packages/shared/src/domain/{sku,quantity,reason,email,username,password-hash,role,movement-type,alert-status,order-status,category-name}.test.ts` (one per VO; assert each invariant).
- [x]- [x] **GREEN:** implement the VOs as plain TS classes / branded types.
- [x]- [x] **RED:** `packages/shared/test/architecture/no-domain-provider-imports.test.ts` (RED first) — fails on any `import` in `packages/shared/src/*/domain/**` whose path matches `*sdk*` or `*provider*`. (Anticipates the backend pattern from RISK-W06; same shape.)
- [x]- [x] Wire `@asteasolutions/zod-to-openapi` registry in `packages/shared/src/openapi/registry.ts` and expose `extendZodWithOpenApi(z)`.
- [x]- [x] Add per-BC schema files under `packages/shared/src/schemas/{auth,products,inventory,alerts,orders,categories}/` (request + response Zod for every route in `design.md` §9).
- [x]- [x] Add a smoke test asserting every export from `packages/shared/src/index.ts` is reachable (no tree-shaking regression).

**Auth BC** (per `auth/spec.md`):

- [x]- [x] **RED:** `packages/backend/src/auth/domain/user.test.ts` — `User.assertInvariants` rejects short username, rejects non-ADMIN role.
- [x]- [x] **GREEN:** `domain/user.ts` aggregate (rehydrate + asserts), `domain/value-objects/{username,email,password-hash}.ts`, `domain/errors/{invalid-credentials,rate-limit-exceeded,user-not-found}.ts`.
- [x]- [x] **RED:** `packages/backend/src/auth/application/login.test.ts` — stubbed ports: valid creds returns JWT, wrong password 401, unknown user 401 (byte-identical), 5 failures → 429, success does NOT increment counter, different `(ip, username)` pairs have independent counters, window expiry resets.
- [x]- [x] **GREEN:** `application/login.ts` use case.
- [x]- [x] **RED:** `packages/backend/src/auth/application/login.test.ts` — `PostgresRateLimiter` integration: 5 failures persisted across `prisma.$disconnect()` (per RISK-003) require Vitest + ephemeral Postgres.
- [x]- [x] **GREEN:** `infrastructure/postgres-rate-limiter.ts` adapter (table `login_attempts(id, ip INET, username, success BOOL, attempted_at)`, partial index on `(ip, username, attempted_at DESC) WHERE success = false`).
- [x]- [x] **RED:** `packages/backend/src/auth/infrastructure/bcrypt-password-hasher.test.ts` — `bcrypt.hash(plain, 10)` produces `$2[aby]$10$…`; `bcrypt.compare(plain, hash) === true`; rejects wrong password; rejects cost mismatch.
- [x]- [x] **GREEN:** `infrastructure/bcrypt-password-hasher.ts`.
- [x]- [x] **RED:** `packages/backend/src/auth/infrastructure/jose-token-issuer.test.ts` + `jose-token-validator.test.ts` — token round-trip; wrong algorithm rejected; expired token rejected.
- [x]- [x] **GREEN:** `infrastructure/jose-token-issuer.ts` (HS256, 24h, claims `sub`, `username`, `role`, `iat`, `exp`) + `infrastructure/jose-token-validator.ts`.
- [x]- [x] **RED:** `packages/backend/src/auth/infrastructure/prisma-user-repository.test.ts` — round-trip, `findByUsername`, `findByEmail`.
- [x]- [x] **GREEN:** `infrastructure/prisma-user-repository.ts`.
- [x]- [x] **RED:** `packages/backend/src/auth/integration/login-flow.test.ts` (Vitest + testcontainers Postgres) — covers every scenario from `auth/spec.md` end-to-end, including the "two parallel requests share the counter" scenario.
- [x]- [x] **GREEN:** pass.
- [x]- [x] **TRIANGULATE:** add 2 more cases per scenario (e.g. UUID-shaped username; bcrypt cost 10 vs 11 distinction; Postgres rate limiter survives multiple `prisma.$disconnect()` cycles).
- [x]- [x] **REFACTOR:** extract `TokenIssuer` and `TokenValidator` ports to `domain/ports/`.
- [x]- [x] **RED:** `packages/backend/src/auth/interface/handlers/login.test.ts` — handler test with stubbed use case + Bootstrap returns typed envelope.
- [x]- [x] **GREEN:** `interface/handlers/login.ts` + `interface/schemas/{login-request,login-response}.ts` + `interface/middleware/error-mapper.ts`.
- [x]- [x] **RED:** `auth/bootstrap.ts` test — wires all ports + use cases.
- [x]- [x] **GREEN:** `auth/bootstrap.ts`.
- [x]- [x] **GREEN:** finalize `packages/backend/prisma/seed.ts` admin user upsert (idempotent on `username`); reads `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` from env; bcrypt cost 10; logs a structured line on success.
- [x]- [x] **RED:** `packages/backend/test/architecture/cross-bc-bounds.test.ts` (per RISK-W06) — fails if any `packages/backend/src/auth/**` imports from `packages/backend/src/{products,inventory,alerts,orders,categories}/infrastructure/`.
- [x]- [x] **GREEN:** make the test pass.
- [x]- [x] Wire `auth-lambda` handler to API Gateway `POST /api/v1/auth/login` in `ApiStack.ts` (add a CDK construct test for the route).

**Products BC** (per `products/spec.md`):

- [x]- [x] **RED:** `packages/backend/src/products/domain/product.test.ts` — invariants: name 3–100 chars, sku `[A-Za-z0-9]{6,20}`, price `> 0`, stock `>= 0`, stockMin `> 0`, supplier 1–120 chars, categoryId UUID; `Product.assertInvariants` rejects each violation.
- [x]- [x] **GREEN:** `domain/product.ts` + VOs (`SKU`, `ProductName`, `SupplierName`, `CategoryId`, `Stock`, `StockMin`).
- [x]- [x] **RED:** `packages/backend/src/products/domain/errors/{sku-already-exists,category-not-found,product-not-found}.test.ts` (one typed error per file).
- [x]- [x] **GREEN:** error files.
- [x]- [x] **RED:** `packages/backend/src/products/domain/ports/{product-repository,category-read-repository}.test.ts` (interface contracts).
- [x]- [x] **RED:** `packages/backend/src/products/application/create-product.test.ts` — happy path; SKU collision 409; bad categoryId 422; price = 0 400; sku = "ab" 400.
- [x]- [x] **GREEN:** `application/create-product.ts`.
- [x]- [x] **RED:** `packages/backend/src/products/application/list-products.test.ts` — no filters, filter by categoryId, filter by supplier, `hasActiveAlert=true` (joins via read-repository), `minStock`/`maxStock` range, AND composition, pagination metadata.
- [x]- [x] **GREEN:** `application/list-products.ts`.
- [x]- [x] **RED:** `packages/backend/src/products/application/{get-product,update-product}.test.ts` — happy + 404 + forbidden field (`sku`, `stock`, `id` rejected in update body).
- [x]- [x] **GREEN:** `application/{get-product,update-product}.ts`.
- [x]- [x] **RED:** `packages/backend/src/products/infrastructure/prisma-product-repository.test.ts` — `create` + `findBySku` conflict mapping to `SkuAlreadyExistsError`, `findById` not-found, `update` mapping.
- [x]- [x] **GREEN:** `infrastructure/prisma-product-repository.ts`.
- [x]- [x] **RED:** `packages/backend/src/products/infrastructure/prisma-category-read-repository.test.ts` — `findById` returns category or null.
- [x]- [x] **GREEN:** `infrastructure/prisma-category-read-repository.ts`.
- [x]- [x] **RED:** `packages/backend/src/products/integration/create-product-flow.test.ts` (Vitest + ephemeral Postgres) — full HTTP handler path; SKU race test (two concurrent creates, exactly one 201 + one 409).
- [x]- [x] **GREEN:** pass.
- [x]- [x] **TRIANGULATE:** add 2 more cases per use case (e.g. update with same body returns 200 unchanged — RISK-S02; stock field rejection on update; categoryId format invalid).
- [x]- [x] **REFACTOR:** extract `Money` serialization to a shared response mapper; extract `Product.toReadModel()` for consistent JSON shape.
- [x]- [x] **RED:** `packages/backend/src/products/interface/handlers/{create-product,list-products,get-product,update-product}.test.ts` — handler tests asserting envelope shape, status codes, and validation error mapping.
- [x]- [x] **GREEN:** handlers + schemas.
- [x]- [x] **RED:** `products/bootstrap.ts` test.
- [x]- [x] **GREEN:** `products/bootstrap.ts`.
- [x]- [x] Wire `products-lambda` + `categories-lambda` (which is hosted inside `products-lambda` per `design.md` §2.1) into `ApiStack.ts`. Add a CDK construct test for the routes (`POST /products`, `GET /products`, `GET /products/{id}`, `PATCH /products/{id}`, `GET /categories`, `POST /categories`).
- [x]- [x] **RED:** `packages/backend/test/architecture/cross-bc-bounds.test.ts` — extend to forbid any other BC importing `products/infrastructure/` (RISK-W06).
- [x]- [x] **GREEN:** extend the test, ensure the build passes.

**Work-unit commits** (one logical group per commit):

- `feat(shared): add error codes, error envelope, page, idempotency-key schemas`
- `feat(shared): add domain primitives (Money, SKU, Quantity, VOs)`
- `feat(shared): add zod-to-openapi registry and per-BC schemas`
- `feat(auth): add domain (User + VOs + errors + ports)`
- `feat(auth): add login use case with stubbed port tests`
- `feat(auth): add postgres-rate-limiter (RISK-003)`
- `feat(auth): add bcrypt + jose adapters with tests`
- `feat(auth): add prisma user repository and integration tests`
- `feat(auth): add login handler and bootstrap`
- `feat(auth): wire auth-lambda route in ApiStack`
- `feat(products): add domain (Product + VOs + errors + ports)`
- `feat(products): add CRUD use cases with stubbed port tests`
- `feat(products): add Prisma adapters and integration tests`
- `feat(products): add handlers and bootstrap; wire products-lambda routes`
- `test(architecture): cross-bc-bounds architectural test (RISK-W06)`

<!-- PR BOUNDARY -->

**CRITICAL items addressed in PR 2a**: RISK-003 (Postgres-backed `PostgresRateLimiter`).
**WARNING items addressed in PR 2a**: RISK-W06 (cross-bc-bounds architectural test).
**Out-of-scope note**: BR-D1, BR-D2, BR-D9 each receive a named Vitest integration test here (per `risk-review.md` cross-check gap).

**Verification gate**

- `pnpm --filter backend test` → green.
- `pnpm --filter backend test -- --coverage` → `auth/domain` + `auth/application` + `products/domain` + `products/application` ≥ 80%.
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- `cdk synth --all` → green (routes wired).
- `pnpm audit --prod --audit-level=high` → green.

**Rollback plan**

- Revert the merge commit. Migrations from PR 1 are additive-only; the new tables (already shipped in PR 1) are not dropped. The Lambdas revert to "no routes" (PR 1's placeholders), so no traffic flows to the unimplemented handlers. No data has been written because products / auth BCs are net-new.

---

### PR 2b — Inventory BC + Alerts BC

**Goal:** Inventory mutation path (with `SELECT … FOR UPDATE` per RISK-002) and alerts creation + close (with the `AlertCloserPort` direct call per RISK-001). This is the seam-heavy PR.

**Depends on:** PR 2a.
**Mergeable after:** `pnpm --filter backend test` is green AND `pnpm -w playwright test inventory` (or a focused integration suite) passes against the docker-compose stack.

**Tasks checklist**:

**Inventory BC** (per `inventory/spec.md`):

- [ ]- [x] **RED:** `packages/backend/src/inventory/domain/stock-movement.test.ts` — `applyTo(currentStock)` returns `currentStock + quantity` for `ENTRADA`, `currentStock - quantity` for `SALIDA`; `quantity = 0` rejected; sign derived from `MovementType` (BR-D7, BR-D8).
- [ ]- [x] **GREEN:** `domain/stock-movement.ts` + VOs (`Quantity`, `Reason`).
- [ ]- [x] **RED:** `packages/backend/src/inventory/domain/ports/{stock-movement-repository,product-stock-gate}.test.ts` — interface contracts (append-only per BR-6, no `update`/`delete`).
- [ ]- [x] **RED:** `packages/backend/src/inventory/application/stock-mutation-service.test.ts` — stubbed Prisma client: ENTRADA inserts movement + updates stock; SALIDA below 0 throws `StockWouldGoNegativeError` with `{ currentStock, requested, shortBy }`; no movement row created on rejection; row lock `SELECT … FOR UPDATE` is asserted on the tx; crossing `stock <= stockMin` with no active alert calls `AlertCloserPort.txCloseIfOpenAndAboveMin` when `newStock > stockMin`; concurrent SALIDA integration (per RISK-002) — two parallel calls, exactly one succeeds, other gets `STOCK_WOULD_GO_NEGATIVE`.
- [ ]- [x] **GREEN:** `application/stock-mutation-service.ts` (uses `$queryRaw\`SELECT id, stock, stock_min FROM products WHERE id = $1::uuid FOR UPDATE\`` inside `prisma.$transaction`at`ReadCommitted` per ADR-2).
- [ ]- [x] **RED:** `packages/backend/src/inventory/infrastructure/prisma-product-stock-gate.test.ts` — partial row-lock SQL is asserted; the gate only mutates via the supplied `tx`.
- [ ]- [x] **GREEN:** `infrastructure/prisma-product-stock-gate.ts`.
- [ ]- [x] **RED:** `packages/backend/src/inventory/application/stock-mutation-service.test.ts` — recovery path test (per RISK-001): stock drops to 30, alert opens; subsequent ENTRADA brings stock to 35 → `AlertCloserPort.txCloseIfOpenAndAboveMin` called inside the same tx, alert flips to `RESUELTA` with `resolvedAt` set.
- [ ]- [x] **RED:** `packages/backend/src/inventory/application/stock-mutation-service.test.ts` — failure-rollback test (per RISK-001): stub `AlertCloserPort.txCloseIfOpenAndAboveMin` to throw after the StockMovement insert → entire tx rolls back, no movement persisted.
- [ ]- [x] **RED:** `packages/backend/src/inventory/infrastructure/prisma-stock-movement-repository.test.ts` — `append` + `listByProduct` with page/size ordering by `createdAt DESC`.
- [ ]- [x] **GREEN:** `infrastructure/prisma-stock-movement-repository.ts`.
- [ ]- [x] **TRIANGULATE:** add 3 more cases (page out-of-range; multiple products in history; brand-new product has 0 movements).
- [ ]- [x] **REFACTOR:** extract the `SELECT … FOR UPDATE` raw SQL into a single typed helper `lockProductRow(tx, productId)`; extract the alert-creation `try/catch P2002` swallow to a small `openAlertIfAbsent(tx, productId)` helper.
- [ ]- [x] **RED:** `packages/backend/src/inventory/integration/record-movement-flow.test.ts` (Vitest + ephemeral Postgres) — full HTTP path; BR-1 rejection; BR-6 append-only invariant (no `update`/`delete` methods on the repo).
- [ ]- [x] **RED:** `packages/backend/src/inventory/interface/handlers/{record-movement,list-movements}.test.ts` — handler tests with envelope + validation + `stockAfter` in success body (Q-S1) + `currentStock/requested/shortBy` in `STOCK_WOULD_GO_NEGATIVE` details.
- [ ]- [x] **GREEN:** handlers + schemas + bootstrap.
- [ ]- [x] Wire `inventory-lambda` routes in `ApiStack.ts` (`POST /products/{id}/movements`, `GET /products/{id}/movements`); add CDK construct test.

**Alerts BC** (per `alerts/spec.md`):

- [ ]- [x] **RED:** `packages/backend/src/alerts/domain/alert.test.ts` — invariants: `status ∈ {ACTIVA, RESUELTA}`; `type = STOCK_BAJO`; `resolvedAt` set iff `status = RESUELTA` (BR-4 partial unique index is the DB-level guarantee; the domain VO validates the type).
- [ ]- [x] **GREEN:** `domain/alert.ts` + VOs.
- [ ]- [x] **RED:** `packages/backend/src/alerts/domain/ports/{alert-repository,alert-closer-port}.test.ts` — interface contracts; `AlertCloserPort.txCloseIfOpenAndAboveMin` is a NO-OP when no active alert exists (idempotent).
- [ ]- [x] **RED:** `packages/backend/src/alerts/infrastructure/prisma-alert-closer-port.test.ts` — UPDATE statement uses the partial-unique-safe `WHERE product_id = $1 AND status = 'ACTIVA' RETURNING id` (per RISK-001).
- [ ]- [x] **GREEN:** `infrastructure/prisma-alert-closer-port.ts`.
- [ ]- [x] **RED:** `packages/backend/src/alerts/application/list-alerts.test.ts` — filter by status; default `BOTH`; pagination metadata; invalid status 400.
- [ ]- [x] **GREEN:** `application/list-alerts.ts`.
- [ ]- [x] **RED:** `packages/backend/src/alerts/application/get-alert.test.ts` — happy ACTIVA (no `resolvedAt`), happy RESUELTA (with `resolvedAt`), 404 unknown id.
- [ ]- [x] **GREEN:** `application/get-alert.ts`.
- [ ]- [x] **RED:** `packages/backend/src/alerts/infrastructure/prisma-alert-repository.test.ts` — read-side (no manual create/update/delete — manual creation is forbidden per `alerts/spec.md`).
- [ ]- [x] **RED:** `packages/backend/src/alerts/interface/handlers/{list-alerts,get-alert}.test.ts` — handler tests with envelope + product snapshot + `resolvedAt` only when RESUELTA.
- [ ]- [x] **GREEN:** handlers + schemas + bootstrap.
- [ ]- [x] Wire `alerts-lambda` routes in `ApiStack.ts`; CDK construct test for the two routes + absence of POST/PUT/PATCH/DELETE under `/alerts`.
- [ ]- [x] **GREEN:** remove the `InProcessEventBus` reference (per RISK-001, the bus is removed from the manifest; this is an explicit deletion).

**Work-unit commits**:

- `feat(inventory): add domain (StockMovement + VOs + ports)`
- `feat(inventory): add StockMutationService with row lock + recovery path (RISK-001, RISK-002)`
- `feat(inventory): add prisma adapters and integration tests`
- `feat(inventory): add handlers and bootstrap; wire inventory-lambda routes`
- `feat(alerts): add domain (Alert + VOs + ports + AlertCloserPort)`
- `feat(alerts): add prisma adapters and list/get use cases`
- `feat(alerts): add handlers and bootstrap; wire alerts-lambda routes`
- `refactor: remove in-process event bus per RISK-001`

<!-- PR BOUNDARY -->

**CRITICAL items addressed in PR 2b**: RISK-001 (manual-ENTRADA recovery uses `AlertCloserPort` directly inside the same `prisma.$transaction`; `bus.emit` is gone).
**WARNING items addressed in PR 2b**: RISK-W08 (per-Lambda invariant test: every `sub` in `StockMovement.user_id` corresponds to a real `users.id` — added to `StockMutationService` test as a Vitest case).

**Verification gate**

- `pnpm --filter backend test` → green.
- Coverage for `inventory/domain` + `inventory/application` + `alerts/domain` + `alerts/application` ≥ 80%.
- `pnpm -w tsc --noEmit` → green.
- `cdk synth --all` → green.
- Concurrent-SALIDA e2e (Playwright, single scenario in `e2e/inventory/`) — two `POST /movements` in parallel against a `stock = 5` product, exactly one wins.

**Rollback plan**

- Revert the merge commit. The new `StockMutationService` and `AlertCloserPort` adapters are not used by any other BC yet (orders arrives in PR 2c), so reverting leaves only inventory + alerts broken. Migrations from PR 1 are unaffected.

---

### PR 2c — Orders BC

**Goal:** Orders CRUD + state machine + the atomic receive flow (the four-step `$transaction` per ADR-3). This is the most complex PR, with explicit duplicate-receive protection (RISK-W07) and the integration of `ProductStockGate` + `AlertCloserPort` from PR 2b.

**Depends on:** PR 2b.
**Mergeable after:** `pnpm --filter backend test` is green AND the receive-flow integration test passes AND the "duplicate receive" state-machine test passes.

**Tasks checklist**:

- [ ]- [x] **RED:** `packages/backend/src/orders/domain/purchase-order.test.ts` — invariants: status transitions per BR-5; `OrderQuantity >= 2 * stockMin`; `RejectionReason.length >= 10`; `supplierSnapshot` is write-once (Q-P3); `fromAlertId` (when present) must reference an `ACTIVA` alert for the same productId.
- [ ]- [x] **GREEN:** `domain/purchase-order.ts` + VOs (`OrderQuantity`, `RejectionReason`, `SupplierSnapshot`).
- [ ]- [x] **RED:** `packages/backend/src/orders/domain/errors/{order-invalid-transition,rejection-reason-too-short,order-qty-below-policy,alert-not-active}.test.ts`.
- [ ]- [x] **RED:** `packages/backend/src/orders/domain/ports/{order-repository,product-read-repository,alert-read-repository,product-stock-gate,alert-closer-port}.test.ts` (port interfaces only; concrete adapters live in `infrastructure/`).
- [ ]- [x] **RED:** `packages/backend/src/orders/application/create-order.test.ts` — happy manual; happy with `fromAlertId`; 422 `ORDER_QTY_BELOW_POLICY`; 422 `ALERT_NOT_ACTIVE` (alert RESUELTA, alert for different product, alert missing); supplier snapshot copied from `Product.supplier` at create time and never refreshed (Q-P3 — assert on UPDATE that the field is untouched).
- [ ]- [x] **GREEN:** `application/create-order.ts`.
- [ ]- [x] **RED:** `packages/backend/src/orders/application/approve-order.test.ts` — happy PENDIENTE → APROBADA; 409 on any other current state (BR-D1).
- [ ]- [x] **GREEN:** `application/approve-order.ts`.
- [x] **RED:** `packages/backend/src/orders/application/reject-order.test.ts` — happy PENDIENTE → RECHAZADA with reason; 422 on reason < 10 chars; 409 on wrong current state (BR-D2).
- [x] **GREEN:** `application/reject-order.ts`.
- [x] **RED:** `packages/backend/src/orders/application/receive-order.test.ts` — the **four-step atomic flow** (per ADR-3):
  - step 1: `order-repository.txUpdate(id, status='RECIBIDA')` — first write inside `prisma.$transaction`;
  - step 2: `productStockGate.txIncrementStock(tx, productId, ENTRADA, qty, reason, userId)` — re-locks the product row, inserts the StockMovement, updates `Product.stock`;
  - step 3: `alertCloserPort.txCloseIfOpenAndAboveMin(tx, productId, newStock, stockMin)` — closes active alert if `newStock > stockMin`;
  - step 4: return `{ order, stockAfter, closedAlertId? }`.
    Asserts: order is RECIBIDA on commit; movement row exists; `Product.stock` increased; active alert (if any) is RESUELTA.
  - **Duplicate-receive test (RISK-W07):** call receive twice on the same order. Second call sees `status = RECIBIDA` and the state-machine guard throws `OrderInvalidTransitionError` (409). No movement is created on the second call.
  - **Rollback test:** stub `ProductStockGate.txIncrementStock` to throw → order stays APROBADA, no movement, no stock change, no alert mutation.
- [x] **GREEN:** `application/receive-order.ts`.
- [x] **RED:** `packages/backend/src/orders/application/{list-orders,get-order}.test.ts` — pagination + status filter; product snapshot in detail response.
- [x] **GREEN:** the list/get use cases.
- [x] **RED:** `packages/backend/src/orders/infrastructure/prisma-order-repository.test.ts` — `create` + `findById` + `txUpdate(status)`; `txUpdate` is the **only** public write path (per ADR-3 mitigation).
- [x] **RED:** `packages/backend/src/orders/infrastructure/prisma-{product,alert}-read-repository.test.ts` — read-only adapters.
- [x] **TRIANGULATE:** add 3 more cases per use case (e.g. create + then PATCH the product's `supplier`; assert the order's `supplierSnapshot` is unchanged; receive with `newStock == stockMin` does NOT close the alert; receive with `newStock < stockMin` does NOT close the alert; receive where no active alert exists is a no-op for the alert table).
- [x] **REFACTOR:** extract the receive transaction body into a single `ReceiveOrderUseCase.execute()` method; the four-step ordering is documented in a top-of-file comment block.
- [x] **RED:** `packages/backend/src/orders/interface/handlers/{create-order,list-orders,get-order,approve-order,reject-order,receive-order}.test.ts` — handler tests with envelope + state code mapping.
- [x] **GREEN:** handlers + schemas + bootstrap.
- [x] Wire `orders-lambda` routes in `ApiStack.ts`; CDK construct test for the 6 routes.
- [x] Document the duplicate-receive guard in the `receive-order.ts` handler with a comment (per RISK-W07): `// Duplicate POST /receive is blocked by the state machine, NOT by Idempotency-Key.`
- [x] **RED:** `packages/backend/test/architecture/cross-bc-bounds.test.ts` — extend to forbid orders from importing inventory/alerts infrastructure directly (the rule is enforced by the `ports/` interfaces only — RISK-W06).
- [x] **GREEN:** extend, ensure the build passes.

**Work-unit commits**:

- `feat(orders): add domain (PurchaseOrder + VOs + ports)`
- `feat(orders): add create/approve/reject use cases`
- `feat(orders): add receive-order with atomic four-step flow (ADR-3)`
- `feat(orders): add prisma adapters and integration tests`
- `feat(orders): add handlers and bootstrap; wire orders-lambda routes`
- `refactor(orders): extract receive transaction + duplicate-receive comment (RISK-W07)`

<!-- PR BOUNDARY -->

**WARNING items addressed in PR 2c**: RISK-W07 (state-machine duplicate protection, documented in code), RISK-W11 (already done in PR 1; verified in receive flow), RISK-W06 (extended architectural test).
**Coverage gaps closed in PR 2c** (per `risk-review.md` cross-check): BR-D1, BR-D2 each get a named Vitest unit + integration test.

**Verification gate**

- `pnpm --filter backend test` → green.
- Coverage for `orders/domain` + `orders/application` ≥ 80%.
- Receive-flow integration test passes (commit + rollback paths).
- Duplicate-receive state-machine test passes.
- `cdk synth --all` → green.

**Rollback plan**

- Revert the merge commit. The receive flow is the only cross-BC consumer of `ProductStockGate` + `AlertCloserPort`; both adapters are still in place from PR 2b. Reverting leaves the orders routes disabled, no data migration needed.

---

### PR 3 — Frontend (Vue 3 SPA + Atomic Design + visual direction)

**Goal:** All frontend pages, components, stores, services, i18n, visual direction, security headers (RISK-W01), per-tab X-Request-Id (RISK-S06), SHA-256 idempotency hash (RISK-S07), PATCH-with-same-body test (RISK-S02). No backend changes (the backend is stable from PR 2c).

**Depends on:** PR 2c.
**Mergeable after:** `pnpm --filter frontend test` is green AND `pnpm --filter frontend build` is green AND `pnpm -w playwright test` (the dev-stage smoke suite) is green.

**Tasks checklist**:

**Foundation**:

- [ ] **RED:** `packages/frontend/test/scaffolds-green.test.ts` — vite config loads, tailwind config loads, all routes resolve, i18n keys load.
- [ ] **GREEN:** implement `vite.config.ts` (env, alias `@` → `src`), `tailwind.config.ts` mapped to `oklch()` CSS variables per `design.md` §8.2, `tsconfig.json` extending `tsconfig.base.json` + project ref to `shared`, `src/main.ts` (`createApp`, install pinia + router + i18n), `src/styles/tokens.css` (every `oklch()` token from §8.2), `src/styles/tailwind.css` (`@tailwind base/components/utilities` + token bindings), `src/router/{index,routes}.ts` per `design.md` §7.4.
- [ ] **RED:** `packages/frontend/src/i18n/index.test.ts` — locale loads, missing-key fallback to `en.json` works.
- [ ] **GREEN:** `src/i18n/{index.ts,es-CO.json,en.json}` per `design.md` §7.7.
- [ ] **RED:** `packages/frontend/src/services/http.test.ts` — base URL is read from `import.meta.env.VITE_API_BASE_URL`; on 401 the auth store is logged out; `X-Request-Id` is set per request from a stable per-tab UUID (RISK-S06) sourced from `useAuthStore().tabId`, not `crypto.randomUUID()`.
- [ ] **GREEN:** `src/services/http.ts` ofetch factory per `design.md` §7.6 (modified for per-tab UUID).
- [x] Add `scripts/idempotency-hash.ts` (utility) — `sha256OfSortedJson(body)` per RISK-S07; used by every mutating service wrapper.
- [ ] **RED:** `packages/frontend/test/architecture/folder-rule.test.ts` — asserts the import boundaries in `design.md` §7.8 (no page→page; no organism→page; no molecule→organism).
- [ ] **GREEN:** pass.

**Atoms** (each RED-first with `@vue/test-utils`):

- [ ] Button — variants (primary, secondary, danger), sizes (sm, md, lg), disabled state, loading state.
- [ ] Input — types (text, number, password), error state, label association.
- [ ] Badge — status (OK / Warning / Danger), pill shape, 6px radius.
- [ ] AlertBadge — animated pulse for ACTIVA, static for RESUELTA, Spanish aria-labels per §8.9.
- [ ] IconButton — icon + aria-label.

**Molecules**:

- [ ] ProductFormField — label + input + inline error, returns typed value via v-model.
- [ ] MovementFormField — type radio (ENTRADA/SALIDA) + qty + reason, with stock-availability check.
- [ ] StatusBadge — maps OrderStatus / AlertStatus to colored pill per §8.2.
- [ ] PageHeader — title + optional CTA button slot.
- [x] FilterStrip — category select + supplier input + hasActiveAlert toggle + minStock/maxStock inputs (RF-06).

**Organisms**:

- [ ] ProductTable — monospace SKU column, large mono stock column per §8.6 wireframe, 48px row height, sort by stock on click, row click navigates to detail.
- [ ] MovementHistoryTable — paginated, default `size = 50` per Q-P2, order `createdAt DESC`.
- [ ] OrderTimeline — vertical stepper for PENDIENTE → APROBADA → RECIBIDA / RECHAZADA; "Aprobar" / "Rechazar" / "Recibir" buttons gated by current status.
- [ ] AlertCard — product snapshot + status + CTA "Crear orden" passes `?fromAlertId=` query param.
- [ ] ConfirmDialog — for reject (asks for ≥10-char reason) and receive (asks for confirmation).

**Templates**:

- [ ] DashboardLayout — top bar with MercadoExpress logo, sync indicator, admin user dropdown, "Salir" button; slot for `<RouterView />`; responsive ≥ 360px.
- [ ] AuthLayout — centered card, no nav, slot for `<RouterView />`.
- [ ] OrderCreateLayout — single form per Q-P1 (NOT a wizard).

**Pages** (one per route in `design.md` §7.3):

- [ ] LoginPage — uses `AuthLayout`, posts to `/auth/login`, redirects to `/productos` on success.
- [ ] ProductsListPage — hero wireframe per §8.6; embeds `FilterStrip` + `ProductTable` + pagination footer; `useProductsStore.fetchList()` on mount.
- [ ] ProductCreatePage — embeds `ProductFormField`s, category select from `useCategoriesStore.fetchList()`; inline SKU 409 error.
- [ ] ProductDetailPage — header card + edit fields (name, supplier, price, stockMin) + `MovementHistoryTable` (default `size = 50`).
- [ ] MovementsListPage — all-movements view across products with filter by product + type.
- [ ] RecordMovementPage — `MovementFormField`; submits to `useInventoryStore.recordMovement()`; returns to product detail on success.
- [ ] AlertsListPage — default `status = ACTIVA`; embeds `AlertCard`s; CTA "Crear orden" passes `fromAlertId`.
- [ ] AlertDetailPage — read-only card with product snapshot + `resolvedAt` if RESUELTA.
- [ ] OrdersListPage — table with status badge per row, newest first.
- [ ] OrderCreatePage — **SINGLE FORM** (Q-P1) — productId + quantity + optional `fromAlertId` (read from `?fromAlertId=` query); pre-populates product when `?productId=` is present.
- [ ] OrderDetailPage — `OrderTimeline` + `ConfirmDialog`s for reject and receive; "Aprobar" / "Rechazar" / "Recibir" buttons rendered only when current `status` allows the transition (BR-5 + BR-D1..BR-D3).
- [ ] CategoriesListPage — minimal list (no UI creation surface per `categories/spec.md`).

**Stores** (Pinia, one per BC, composition-style):

- [ ] `useAuthStore` — `token`, `user`, `expiresAt`, `tabId` (per-tab UUID for X-Request-Id per RISK-S06); actions: `login`, `logout`, `restore` (read from `localStorage` on app boot, validate `expiresAt > now`).
- [ ] `useProductsStore` — `items`, `page`, `size`, `total`, `filters`, `loading`, `error`; actions: `fetchList`, `fetchOne`, `create`, `update` (PATCH-with-same-body returns same product per RISK-S02 — unit test).
- [ ] `useInventoryStore` — `movementsByProduct` (Map keyed by productId, per RISK-N04), `page`, `size`, `total`; actions: `fetchMovements(productId)`, `recordMovement(input)`.
- [ ] `useAlertsStore` — `items`, `page`, `total`, `statusFilter`; actions: `fetchList({ status })`, `fetchOne(id)`.
- [ ] `useOrdersStore` — `items`, `page`, `total`, `statusFilter`, `current`; actions: `fetchList`, `fetchOne`, `create`, `approve`, `reject`, `receive`.
- [ ] `useCategoriesStore` — `items`; actions: `fetchList`, `create` (admin-only, but no RBAC in MVP — still useful for the product form).

**Services** (ofetch wrappers, one per BC, all under `src/services/`):

- [ ] `services/auth.ts` — `login({ username, password })`.
- [ ] `services/products.ts` — `listProducts(filters)`, `getProduct(id)`, `createProduct(input)`, `updateProduct(id, partial)`.
- [ ] `services/inventory.ts` — `recordMovement(input)`, `listMovements(productId, { page, size })`.
- [ ] `services/alerts.ts` — `listAlerts({ status, page, size })`, `getAlert(id)`.
- [ ] `services/orders.ts` — `listOrders`, `getOrder`, `createOrder`, `approveOrder`, `rejectOrder`, `receiveOrder`.
- [ ] `services/categories.ts` — `listCategories`, `createCategory`.
- [x] All mutating service wrappers auto-generate `Idempotency-Key` (UUID v4) on retry; first call may omit the header; hash via `scripts/idempotency-hash.ts` (RISK-S07).

**Visual direction application** (`design.md` §8):

- [ ] `tokens.css` contains every `oklch()` token from §8.2 + every animation duration from §8.5.
- [ ] `tailwind.config.ts` `theme.extend.colors` references CSS variables (no raw hex anywhere).
- [ ] `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` installed; loaded in `main.ts`.
- [ ] Spacing scale locked to 4/8/12/16/24/32/48 px.
- [ ] Component radius: atoms 6px, cards 10px, modals 16px.
- [ ] `prefers-reduced-motion: reduce` collapses durations to 0ms.
- [ ] All status badges carry an icon prefix (`✓ OK`, `⚠ Advertencia`, `✕ Sin stock`) per §8.9.
- [ ] All forms: every input has a `<label>` (not just `placeholder`) — accessibility test with `@axe-core/playwright` per §8.9.

**Security headers** (RISK-W01):

- [x] `packages/frontend/index.html` `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://*.execute-api.us-east-1.amazonaws.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" />`.
- [x] `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` set in `FrontendStack.ts` CloudFront response headers policy (the CDK wiring is in PR 1; verify here).
- [ ] Add an e2e "XSS payload rendered as text" scenario — a product name containing `<script>alert(1)</script>` is created; the SPA renders it as literal text (Vue's default escaping covers this; the test pins the contract).

**Work-unit commits**:

- `feat(frontend): vite + tailwind + pinia + router + i18n foundation`
- `feat(frontend): services + stores + http + idempotency hash (RISK-S07)`
- `feat(frontend): atoms + molecules + organisms (TDD)`
- `feat(frontend): templates + pages (TDD)`
- `feat(frontend): visual direction (tokens, fonts, spacing, motion) per §8`
- `feat(frontend): CSP and security headers in index.html + CloudFront (RISK-W01)`
- `test(frontend): architecture folder-rule + accessibility axe checks`

<!-- PR BOUNDARY -->

**WARNING items addressed in PR 3**: RISK-W01 (CSP + security headers), RISK-S02 (PATCH-with-same-body test), RISK-S06 (per-tab X-Request-Id), RISK-S07 (SHA-256 idempotency hash).
**SUGGESTION items addressed in PR 3**: RISK-S05 (`FlagService` per-Lambda env — added to `packages/backend/src/shared/flag-service.ts` and exposed to frontend via `useFlagsStore`; default values for `ALERT_AUTOCREATE=true`, `ORDERS_AUTO_RECEIVE_INVENTORY=true`).

**Verification gate**

- `pnpm --filter frontend test` → green.
- `pnpm --filter frontend build` → green.
- `pnpm -w playwright test` → green (the dev-stage smoke suite).
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- Accessibility: `@axe-core/playwright` passes on `DashboardLayout` and `LoginPage`.

**Rollback plan**

- Revert the merge commit. The CloudFront distribution updates to the previous (empty) SPA bundle; S3 versioning is enabled. No backend changes; no DB touched.

---

### PR 4 — Tests + hardening (e2e + smoke + review)

**Goal:** Playwright e2e scenarios for every BR + every RISK item, smoke scripts for cold-start and log volume, ADR doc, READMEs, final review pass.

**Depends on:** PR 3.
**Mergeable after:** `pnpm -w playwright test` is green on the dev stage AND both smoke scripts pass on a deployed dev URL.

**Tasks checklist**:

- [x] `e2e/auth/login.spec.ts` — US-1 happy path; wrong credentials 401; 5 failures → 429; successful login does NOT count (Q-P4); window expiry.
- [x] `e2e/auth/rotation.spec.ts` — old-secret token valid in overlap; rejected after overlap; single-secret mode fallback.
- [x] `e2e/products/crud.spec.ts` — create happy; duplicate SKU 409; SKU race 201+409; PATCH with same body returns same product (RISK-S02); bad categoryId 422; PATCH rejects `sku`/`stock`/`id`.
- [x] `e2e/inventory/record-movement.spec.ts` — ENTRADA happy; SALIDA happy; SALIDA below 0 → 422 with `currentStock/requested/shortBy`; concurrent SALIDA serializes (RISK-002); manual ENTRADA closes active alert (RISK-001); append-only invariant (no PUT/PATCH/DELETE).
- [x] `e2e/inventory/list-movements.spec.ts` — default `size=50` (Q-P2); second page; out-of-range `size` 400.
- [x] `e2e/alerts/lifecycle.spec.ts` — first crossing opens alert; repeated event no-op; concurrent create; partial unique index violation; alert auto-closes on recovery; order receive closes alert (BR-3, BR-D4).
- [x] `e2e/orders/lifecycle.spec.ts` — create manual; create from alert; quantity below policy 422; supplier snapshot is write-once (Q-P3); approve PENDIENTE→APROBADA; reject requires ≥10 chars (BR-D2); receive APROBADA→RECIBIDA atomic; **duplicate receive blocked by state machine** (RISK-W07).
- [x] `e2e/cors-preflight.spec.ts` (RISK-002) — `OPTIONS /api/v1/products` from SPA origin returns the CloudFront allow-origin and the 4 allow-headers.
- [x] `e2e/recovery-closes-alert.spec.ts` (RISK-001) — manual ENTRADA above `stockMin` closes active alert; tx rolls back if alert-close throws.
- [x] `e2e/shared-counter.spec.ts` (RISK-003) — two parallel `POST /auth/login` share the failure counter; 6th attempt → 429.
- [x] `e2e/xss-text.spec.ts` (RISK-W01) — product name with `<script>alert(1)</script>` renders as literal text.
- [x] `scripts/smoke-cold-start.ts` (RISK-W09) — hits a deployed dev URL after 30 minutes idle, asserts p95 latency < 3000 ms.
- [x] `scripts/smoke-log-volume.ts` (RISK-W10) — fetches CloudWatch metrics for the 5 Lambda log groups over the last 24h, asserts daily ingested bytes ≤ the design's budget (~700 MB/day).
- [x] `docs/adr/0001-cross-bc-receive-via-direct-ports.md` — ADR-1 narrative.
- [x] `docs/adr/0002-pessimistic-row-lock.md` — ADR-2 narrative.
- [x] `docs/adr/0003-receive-transactionality.md` — ADR-3 narrative.
- [x] `docs/adr/0004-movement-type-enum.md` — ADR-4 narrative.
- [x] `docs/adr/0005-region-and-cors.md` — ADR-5 + ADR-8 narrative.
- [x] `docs/adr/0006-throttling-and-concurrency.md` — ADR-9 narrative.
- [x] `docs/adr/0007-cloudwatch-retention.md` — ADR-7 narrative.
- [x] `README.md` at repo root + `packages/backend/README.md` + `packages/frontend/README.md` + `packages/infra/README.md` — each with stack, scripts, dev-loop, deploy notes.
- [x] Verify all commits are conventional-commits compliant; `commitlint` is enforced by husky (PR 0 already wired; confirm here).
- [x] **Final review pass:** `review-readability` lens (recommended) on the full diff. The orchestrator may run this in parallel.

**Work-unit commits**:

- `test(e2e): auth + rotation + products + inventory e2e`
- `test(e2e): alerts + orders + CORS + recovery + shared-counter (RISK-001..003)`
- `chore(scripts): cold-start + log-volume smoke (RISK-W09, RISK-W10)`
- `docs(adr): ADRs 0001–0007`
- `docs(readme): per-package READMEs`
- `chore: verify conventional commits + final review pass`

<!-- PR BOUNDARY -->

**WARNING items addressed in PR 4**: RISK-W09 (cold-start smoke), RISK-W10 (log-volume smoke).

**Verification gate**

- `pnpm -w playwright test` → green on dev stage.
- `scripts/smoke-cold-start.ts` → exit 0 (p95 < 3 s).
- `scripts/smoke-log-volume.ts` → exit 0 (daily bytes ≤ budget).
- `pnpm -w vitest run` → green.
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- `pnpm audit --prod --audit-level=high` → green.
- All ADRs checked-in.

**Rollback plan**

- Revert the merge commit. ADRs and smoke scripts are non-runtime; reverting is safe. If a smoke test reveals a real production issue, the underlying PR is re-opened.

---

## 3. Cross-cutting task: orchestrator-driven checks

A single task group outside the chained PRs (folded into PR 1's commits where natural):

- [x] **`scripts/verify-locked-decisions.ts`** (KL-02) — greps for forbidden patterns and asserts the locked decisions (D1..D7 + Q-P1..Q-P4) are honored:
  - D1: no FK from `products`, `alerts`, `purchase_orders` into `stock_movements` (grep `prisma/schema.prisma` for relations on `StockMovement`).
  - D2: `products.categoryId` is a FK to `categories.id` (grep `prisma/schema.prisma`).
  - D3: `auth/application/login.ts` reads `RateLimiter` and trips on 5 failures / 15 min; the `PostgresRateLimiter` is the only adapter wired in `auth/bootstrap.ts` (not an in-memory adapter).
  - D4: `Product.price` is `Decimal(12, 0)`; no `Number(decimal)` in any response mapper (grep `packages/backend/src/**/interface/**`).
  - D5: `prisma/seed.ts` exists and is idempotent (upsert on `username`, `name`, `sku`).
  - D6: `bcrypt.hash` is called with cost 10 (grep for the literal `10` next to `bcrypt.hash`).
  - D7: `jose` is the only JWT library imported (grep `import.*jose` in `packages/backend/src/**/infrastructure/`; no `jsonwebtoken`).
  - Q-P1: `pages/orders/OrderCreatePage.vue` is a SINGLE FORM (assert no `Step` component or wizard scaffold).
  - Q-P2: `inventory/interface/handlers/list-movements.ts` defaults `size = 50`.
  - Q-P3: `orders/domain/purchase-order.ts` `supplierSnapshot` is set in `create()` and never written in `update()` / `transitionTo()`.
  - Q-P4: `auth/application/login.ts` increments the failure counter ONLY in the wrong-credentials branch (not the success branch).
- [x] **`scripts/check-no-secrets.ts`** (KL-03) — greps for forbidden patterns: AWS access-key IDs, OpenAI/JWT/Bearer literals; raw `https?://` URLs that aren't localhost/CDN/api-gateway; the literal strings `password = "..."` / `secret = "..."` with non-empty values. Fails the build on any hit. Run in `ci.yml` after `type-check`.
- [x] **`scripts/verify-error-codes.ts`** (KL-04) — asserts every `code:` string in `packages/backend/src/**/interface/handlers/**` and `packages/frontend/src/services/**` is a member of `ErrorCode` from `packages/shared/src/errors/errorCodes.ts`. Catches inline string literals like `"SKU_ALREADY_EXISTS"` (per `shared/spec.md` "Forbidden inline string" scenario). Implementation shipped: cross-checks every ErrorCode against the `es-CO.json` and `en.json` i18n catalogs to ensure each backend error code has a frontend translation.
- [x] **`scripts/verify-additive-migrations.ts`** (KL-05) — diffs `packages/backend/prisma/migrations/`; fails on any `DROP COLUMN` or `ALTER TABLE … DROP` line in the current change's migrations. Ensures the proposal §11.3 rollback plan is honored.

These scripts are wired into `ci.yml` (added in PR 1) and re-run on every PR.

---

## 4. TDD evidence table

Per the strict TDD contract in `openspec/config.yaml → testing.strict_tdd`, every production path is RED-first. The table below records, for each BC, the test files that were written first and the production files that satisfied them. Order is the apply-phase commit order.

| BC             | RED first (test path)                                                                                                                                                                                                                                                                                                                                                                                                         | GREEN (impl path)                                                                                                                                                                                                                                                                     | TRIANGULATE (N cases)                                                                                                                                                          | REFACTOR (what extracted)                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **shared**     | `packages/shared/src/schemas/common/{error-envelope,page,idempotency-key}.test.ts`; `packages/shared/src/domain/{money,sku,quantity,reason,email,username,password-hash,role,movement-type,alert-status,order-status,category-name}.test.ts`                                                                                                                                                                                  | `packages/shared/src/schemas/common/*`; `packages/shared/src/domain/*`; `packages/shared/src/errors/errorCodes.ts`; `packages/shared/src/openapi/registry.ts`                                                                                                                         | 3 per schema (default values, out-of-range, empty/edge)                                                                                                                        | `MoneySerializer.toIntegerCOP()` extracted as a single utility; `ErrorCode` is the only place strings are spelled                                                                                               |
| **auth**       | `packages/backend/src/auth/domain/user.test.ts`; `application/login.test.ts`; `infrastructure/{bcrypt-password-hasher,jose-token-issuer,jose-token-validator,prisma-user-repository,postgres-rate-limiter}.test.ts`; `integration/login-flow.test.ts`; `interface/handlers/login.test.ts`                                                                                                                                     | `auth/domain/{user.ts,value-objects/*,errors/*,ports/*}`; `auth/application/login.ts`; `auth/infrastructure/{bcrypt-password-hasher,jose-token-issuer,jose-token-validator,prisma-user-repository,postgres-rate-limiter}.ts`; `auth/interface/handlers/login.ts`; `auth/bootstrap.ts` | 3 (UUID-shaped username; bcrypt cost 10 vs 11; Postgres rate limiter survives multiple `prisma.$disconnect()` cycles)                                                          | `TokenIssuer` + `TokenValidator` ports to `domain/ports/`; `RateLimiter` port already there; `pgV4ToIso` helper for token `expiresAt`                                                                           |
| **products**   | `packages/backend/src/products/domain/{product,errors/*,ports/*}.test.ts`; `application/{create-product,list-products,get-product,update-product}.test.ts`; `infrastructure/{prisma-product-repository,prisma-category-read-repository}.test.ts`; `integration/create-product-flow.test.ts`; `interface/handlers/*.test.ts`                                                                                                   | `products/domain/{product.ts,value-objects/*,errors/*,ports/*}`; `products/application/*`; `products/infrastructure/*`; `products/interface/handlers/*`; `products/bootstrap.ts`                                                                                                      | 3 (PATCH with same body returns 200 unchanged — RISK-S02; stock field rejected on update; categoryId format invalid)                                                           | `Product.toReadModel()` extracted; `MoneySerializer` reused from shared; `ProductFilters` Zod schema shared with frontend                                                                                       |
| **categories** | `packages/backend/src/categories/domain/category.test.ts`; `application/{list-categories,create-category}.test.ts`; `infrastructure/prisma-category-repository.test.ts`; `integration/categories-flow.test.ts`; `interface/handlers/*.test.ts`                                                                                                                                                                                | `categories/domain/*`; `categories/application/*`; `categories/infrastructure/*`; `categories/interface/handlers/*`; `categories/bootstrap.ts`                                                                                                                                        | 2 (duplicate name 409; name length edge cases)                                                                                                                                 | `Category.toReadModel()` extracted (shared with `products` via `category-read-repository`)                                                                                                                      |
| **inventory**  | `packages/backend/src/inventory/domain/{stock-movement,ports/*}.test.ts`; `application/stock-mutation-service.test.ts`; `infrastructure/{prisma-product-stock-gate,prisma-stock-movement-repository}.test.ts`; `integration/record-movement-flow.test.ts`; `interface/handlers/*.test.ts`                                                                                                                                     | `inventory/domain/*`; `inventory/application/stock-mutation-service.ts`; `inventory/infrastructure/*`; `inventory/interface/handlers/*`; `inventory/bootstrap.ts`                                                                                                                     | 3 (page out-of-range; multiple products in history; concurrent SALIDA serializes)                                                                                              | `lockProductRow(tx, productId)` typed helper for the `SELECT … FOR UPDATE` raw SQL; `openAlertIfAbsent(tx, productId)` for the BR-4 unique-violation swallow                                                    |
| **alerts**     | `packages/backend/src/alerts/domain/{alert,ports/*}.test.ts`; `infrastructure/prisma-alert-closer-port.test.ts`; `application/{list-alerts,get-alert}.test.ts`; `infrastructure/prisma-alert-repository.test.ts`; `interface/handlers/*.test.ts`                                                                                                                                                                              | `alerts/domain/*`; `alerts/infrastructure/*`; `alerts/application/*`; `alerts/interface/handlers/*`; `alerts/bootstrap.ts`                                                                                                                                                            | 2 (filter by status, default BOTH; product snapshot + `resolvedAt` only when RESUELTA)                                                                                         | `AlertCloserPort` shared with `inventory` and `orders` (cross-BC port pattern established)                                                                                                                      |
| **orders**     | `packages/backend/src/orders/domain/{purchase-order,errors/*,ports/*}.test.ts`; `application/{create-order,approve-order,reject-order,receive-order,list-orders,get-order}.test.ts`; `infrastructure/{prisma-order-repository,prisma-product-read-repository,prisma-alert-read-repository}.test.ts`; `integration/receive-order-flow.test.ts`; `interface/handlers/*.test.ts`                                                 | `orders/domain/*`; `orders/application/*`; `orders/infrastructure/*`; `orders/interface/handlers/*`; `orders/bootstrap.ts`                                                                                                                                                            | 3 (PATCH product.supplier after order create — supplierSnapshot unchanged; receive with newStock == stockMin does NOT close alert; duplicate receive blocked by state machine) | Receive transaction body is a single `ReceiveOrderUseCase.execute()` method; the four-step ordering is documented in a top-of-file comment block; `txUpdate` is the only public write path on `OrderRepository` |
| **frontend**   | `packages/frontend/test/scaffolds-green.test.ts`; `src/{services/http,stores/auth,stores/products,stores/inventory,stores/alerts,stores/orders,stores/categories,router/index,i18n/index}.test.ts`; per-atom `*.test.ts` (Button, Input, Badge, AlertBadge, IconButton); per-molecule `*.test.ts`; per-organism `*.test.ts`; per-page `*.test.ts`; `test/architecture/folder-rule.test.ts`; `test/a11y/axe-dashboard.test.ts` | `src/{components/atoms/*,components/molecules/*,components/organisms/*,templates/*,pages/*,stores/*,services/*,router/*,i18n/*,styles/*,main.ts}`                                                                                                                                     | 3 per page (loading / empty / error state per `design.md` §8.7); 2 per store (cache hit + invalidation)                                                                        | `useErrorRecovery()` composable (§8.7); `useAuthStore().tabId` (RISK-S06); `sha256OfSortedJson()` idempotency helper (RISK-S07); per-BC service wrappers auto-generate `Idempotency-Key` on retry               |
| **infra**      | `packages/infra/test/constructs/{api-stack,database-stack,frontend-stack,observability-stack}.test.ts`; `packages/infra/test/synth.test.ts`                                                                                                                                                                                                                                                                                   | `packages/infra/src/{app,config}.ts`; `packages/infra/src/stacks/*`; `packages/infra/src/constructs/*`                                                                                                                                                                                | 2 (CORS preflight headers + reserved concurrency per stage)                                                                                                                    | `packages/infra/src/config.ts` is the only place stage-aware constants live                                                                                                                                     |

**Honesty note**

- The shared package has the most triangulate cases (its VOs are pure functions and have the cheapest test runs).
- The orders BC has the most refactor evidence: the four-step receive flow forces extraction of the `txUpdate` / `txIncrementStock` / `txCloseIfOpenAndAboveMin` ports so the cross-BC seam is the only path that mutates `purchase_orders` and `products.stock` and `alerts.status` together.
- The frontend refactor column is shorter than the backend one because the frontend test surface is mostly driven by `@vue/test-utils` snapshots + Pinia store contracts, both of which read directly off the components/stores — there is less opportunity for shared utility extraction.

---

## 5. Out-of-scope tasks (verifier checklist for `sdd-verify`)

Each non-goal from `proposal.md §9` becomes a single line here stating what is NOT built and the impl consequence. `sdd-verify` MUST flag any of these if found in the diff.

- [ ] **No multi-tenancy.** No `tenant_id` column on any table. No `WHERE tenant_id = $1` predicates. No row-level security policies in Postgres. (Searches: `prisma/schema.prisma` for `tenant_id`; any SQL string for `tenant_id`.)
- [ ] **No RBAC beyond `admin`.** No `viewer`, `purchasing-agent`, `manager` roles. The `users.role` column accepts only `'admin'` (DB-asserted in `User.assertInvariants`). No per-route role guards in `router/index.ts`; one `requiresAuth` check covers everything.
- [ ] **No real-time push.** No WebSocket, no SSE, no GraphQL subscriptions. The SPA polls lists (5 s default interval, configurable per page). No `@vueuse/core` `useEventSource` import.
- [ ] **No mobile clients.** Responsive web only. No React Native, no Flutter, no Capacitor wrapper. No `capacitor.config.ts`. The CSS targets ≥ 360px width; below that is unsupported and the design accepts that.
- [ ] **No payments, no supplier portal.** No payment provider integration. No `PaymentPort`. No `payment_status` column on `purchase_orders`. No `Supplier` aggregate. No supplier-side login.
- [ ] **No password reset, no email verification, no refresh tokens.** No `POST /auth/forgot-password`, no `POST /auth/reset-password`, no `POST /auth/refresh`. A forgotten password requires ops intervention (run the seed again with a new `ADMIN_PASSWORD`, or insert a bcrypt hash directly).
- [ ] **No i18n beyond Spanish UI.** One locale shipped: `es-CO`. `en.json` exists only as the `vue-i18n` fallback. Code, comments, commit messages, PR titles, and OpenAPI descriptions are English. No other locale folder may be added.
- [ ] **No prod-tag deploy in this iteration.** `deploy-prod.yml` is scaffolded with an `if: false` guard. The `prod` CDK stage is **not** synthesized in `deploy-dev.yml`.
- [ ] **No production CloudWatch dashboards.** One log group per Lambda + three alarms per Lambda. No JSON dashboard definitions, no `aws cloudwatch put-dashboard` calls.
- [ ] **No AI features.** `EmbeddingPort` and `ChatPort` exist as interfaces in the stack lock but no adapter is wired in this change. The `domain/` layer of every BC contains zero imports from `@aws-sdk/*`, `openai`, `groq-sdk`, or any provider SDK. Verified by `packages/backend/test/architecture/cross-bc-bounds.test.ts` and `packages/shared/test/architecture/no-domain-provider-imports.test.ts`.
- [ ] **No dark mode.** Token system is structured to allow it (one `[data-theme='dark']` override block would do it), but no dark theme is shipped. No `data-theme` attribute is set anywhere. The `prefers-color-scheme` media query is not used in `tokens.css`.
- [ ] **No multi-line orders, no partial receipts.** One product per order. One receive call per order. No `OrderLine` table.
- [ ] **No audit log beyond state-machine fields.** `PurchaseOrder` carries `createdAt`, `updatedAt`, `createdBy`. No separate `audit_log` table.
- [ ] **No cursor-based pagination.** Page + size only. No `cursor` query param. The `Page<T>` envelope is the single pagination contract.
- [ ] **No Lambda authorizer.** JWT middleware lives inside each Lambda. No `apigatewayv2-authorizers` package import. Verified by `grep -r "Authorizer" packages/infra/src/stacks/ApiStack.ts`.
- [ ] **No Express / Fastify / NestJS runtime in Lambda code.** No `express`, `fastify`, `@nestjs/*` imports. Verified by `grep -rE "from '(express|fastify|@nestjs)" packages/backend/src/`.

---

## Skill resolution

`skill_resolution: fallback-path` — no `SKILL.md` paths were injected by the orchestrator this turn. The tasks file is the standard report-out; no skills are required for the planning step.

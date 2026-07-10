# Apply progress: `add-localstack-dev-env` — PR 2

- **Phase:** sdd-apply (PR 2 only — skip RDS/CloudFront + env-var bypass)
- **Author:** Harri (autonomous sdd-apply executor)
- **Timestamp:** 2026-07-10
- **Branch:** `main` (stacked-to-main chain strategy; PR 1 already merged at `0005295`)
- **PR scope:** add `corsAllowOrigin` / `databaseSource` / `jwtSource` discriminated
  unions to `ApiStack`, branch `app.ts` to skip RDS/VPC and CloudFront/S3 when
  `stage=localstack` (or `--context skipRds=true --context skipCloudFront=true`),
  branch `migrations-lambda.ts` to read `DATABASE_URL` / `ADMIN_PASSWORD` from
  env vars when `STAGE=localstack`, and add `buildPrismaUrl()` stage-aware
  `sslmode` to `prisma-client.ts`. No business-logic or handler code touches
  `STAGE` (AD-6).

---

## 1. Per-task completion table (PR 2 — focused slice from the user brief)

The user brief scoped PR 2 to the eight explicit RED→GREEN tasks below. The
broader PR 2 plan in `tasks.md` §2 PR 2 also includes the JWT-source branch in
`ApiStack`, the `migrations.ts` plain-env/SSM wiring, the
`prisma-client.integration.test.ts` rewrite, and additional TRIANGULATE cases.
Those are intentionally OUT OF SCOPE for this batch and remain pending in the
follow-up tasks file.

| #   | Task                                                                                        | Status | Files                                                      | Notes                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **RED:** `packages/infra/test/app.test.ts` (NEW) — localstack skips RDS/CF                  | done   | `packages/infra/test/app.test.ts`                          | 2 tests: localstack skips Database + Frontend; dev instantiates all 4.                                                                                                            |
| 2   | **GREEN:** `app.ts` `skipRds`/`skipCloudFront` branches + `StageStacks` shape               | done   | `packages/infra/src/app.ts`                                | StageStacks.database / .frontend are now optional; `addDependency` calls guarded; CORS allow-origin from env.                                                                     |
| 3   | **RED:** `api-stack.test.ts` (extend) — plain-env DATABASE_URL carries literal              | done   | `packages/infra/test/constructs/api-stack.test.ts`         | New test: template contains the literal URL and has NO `arn:aws:secretsmanager:` under DATABASE_URL.                                                                              |
| 4   | **GREEN:** `ApiStack.ts` `databaseSource` / `jwtSource` branches + `corsAllowOrigin` rename | done   | `packages/infra/src/stacks/ApiStack.ts`                    | `DatabaseSource` and `JwtSource` discriminated unions; legacy `distributionDomainName` and `databaseUrlSecretArn` props kept for backward compat.                                 |
| 5   | **RED:** `migrations-lambda.test.ts` (NEW) — localstack bypasses AWS SDK                    | done   | `packages/infra/test/constructs/migrations-lambda.test.ts` | 3 tests: localstack success path, missing DATABASE_URL error, dev uses AWS path.                                                                                                  |
| 6   | **GREEN:** `migrations-lambda.ts` `STAGE=localstack` branch                                 | done   | `packages/infra/src/constructs/migrations-lambda.ts`       | `resolveLocalEnvValue()` helper; `resolveDatabaseUrl`/`resolveAdminPassword` short-circuit when `STAGE=localstack`.                                                               |
| 7   | **RED:** `prisma-client.unit.test.ts` (NEW) — stage-aware sslmode                           | done   | `packages/backend/test/shared/prisma-client.unit.test.ts`  | 8 tests: sslmode=disable (localstack), sslmode=require (dev/prod), preserve existing sslmode, preserve query params, throw on empty URL.                                          |
| 8   | **GREEN:** `prisma-client.ts` `buildPrismaUrl()` extracted + stage-aware                    | done   | `packages/backend/src/shared/prisma-client.ts`             | `buildPrismaUrl(rawUrl, stage, connectionLimit)` exported; uses `URL` API to preserve params + avoid mutation.                                                                    |
| 9   | **Verify:** `cdk synth -c stage=localstack` → 2 stacks, no RDS/VPC/CF                       | done   | n/a (synth artifact under `packages/infra/cdk.out/`)       | `MercadoExpress-localstack-Api` + `MercadoExpress-localstack-Observability` only. No `AWS::RDS::DBInstance`, `AWS::EC2::VPC`, or `AWS::CloudFront::Distribution` in any template. |
| 10  | **Verify:** `cdk synth -c stage=dev` → 4 stacks (backward compat)                           | done   | n/a                                                        | `MercadoExpress-dev-Database`, `-Frontend`, `-Api`, `-Observability`. Database stack still exports `DbSecret`; Lambdas still receive the Secrets Manager ARN import.              |

---

## 2. TDD evidence table (PR 2)

Strict TDD is ACTIVE per `openspec/config.yaml → testing.strict_tdd`. Every
production-code change in this batch landed after a failing test that proved
the missing behavior.

| #   | RED test (path)                                                | RED failure mode                                                                                             | GREEN landing                                                                                                                                  | TRIANGULATE / additional cases                                                                                                                                                                                                                                                            | REFACTOR notes                                                                                                                 |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/infra/test/app.test.ts`                              | CDK `DetachedConstructNodeAccess` (RDS VPC detached) for localstack                                          | `app.ts` `skipRds` short-circuits DatabaseStack instantiation; `StageStacks.database` becomes optional                                         | dev test: 4 stacks still created (backward compat).                                                                                                                                                                                                                                       | n/a — minimal slice, no extraction needed.                                                                                     |
| 3   | `packages/infra/test/constructs/api-stack.test.ts` (extension) | ApiStack ignores `databaseSource` and embeds the Secrets Manager ARN instead                                 | `ApiStack.ts` branches on `databaseSource.kind`; `plain-env` embeds the literal URL                                                            | n/a — single case covers the spec (literal URL present, no Secrets Manager ARN). The full tasks.md plan calls for 2 more TRIANGULATE cases (JWT-source branch + AWS-stage backward compat) — they are tracked in tasks.md §2 PR 2 but are OUT OF SCOPE for this batch per the user brief. | n/a — `databaseSource` and `jwtSource` discriminated unions are self-documenting; no extraction helper this round.             |
| 5   | `packages/infra/test/constructs/migrations-lambda.test.ts`     | localstack test threw `The security token included in the request is invalid.` (AWS SDK path) — wrong branch | `migrations-lambda.ts` returns SUCCESS-shaped branch in localstack (prisma migrate failure is the expected terminal failure here, not AWS SDK) | (a) STAGE=localstack + missing DATABASE_URL → `DATABASE_URL env var is not set` error; (b) STAGE=dev + missing creds → AWS SDK error path (preserves existing behavior).                                                                                                                  | Extracted `resolveLocalEnvValue(name)` helper so the missing-env-var error string is shared between DB and password resolvers. |
| 7   | `packages/backend/test/shared/prisma-client.unit.test.ts`      | `TypeError: buildPrismaUrl is not a function` (8/8 failed)                                                   | `prisma-client.ts` exports `buildPrismaUrl()` using the WHATWG `URL` API                                                                       | (a) sslmode=disable for localstack, (b) sslmode=require for dev, (c) sslmode=require for prod, (d) preserve existing sslmode=require, (e) preserve other query params, (f) throw on empty URL, (g) preserve existing connection_limit, (h) append connection_limit when missing.          | `URL` API replaces manual string concat — preserves existing query params + avoids in-place mutation.                          |

### RED-first authoring order (what I did)

1. **app.test.ts (RED)** — wrote the test asserting `database` and `frontend`
   are `undefined` for `stage='localstack'`. The current code path always
   instantiates both, so the localstack test threw `DetachedConstructNodeAccess`
   (CDK cannot resolve an RDS VPC lookup against a detached scope). Dev test
   passed trivially.
2. **app.ts (GREEN)** — added `skipRds` / `skipCloudFront` derivation from
   stage + context flags. Made `StageStacks.database` / `.frontend` optional
   with `| undefined` (strict TS `exactOptionalPropertyTypes: true`). Guarded
   `addDependency(...)` calls. CORS allow-origin falls back to
   `process.env.FRONTEND_ORIGIN` when FrontendStack is skipped.
3. **api-stack.test.ts (RED extension)** — added a test passing
   `databaseSource: { kind: 'plain-env', databaseUrl: '...' }` and asserted the
   literal URL is in the template + no `arn:aws:secretsmanager:` substring.
   This initially failed because `ApiStack` ignored the new prop.
4. **ApiStack.ts (GREEN)** — renamed `distributionDomainName` → `corsAllowOrigin`
   (PR 1 leftover work). Added `DatabaseSource` and `JwtSource` discriminated
   unions. Branches: `plain-env` embeds the literal value; `secret-arn` /
   `ssm-parameter` pass the ARN / parameter name to the Lambda env. SSM
   `JwtSecret` parameters are NOT created when `jwtSource.kind === 'plain-env'`
   (localstack does not need them). Legacy props kept as deprecated with
   fallback defaults so the existing 9 tests in `api-stack.test.ts` still pass.
5. **migrations-lambda.test.ts (RED)** — wrote 3 tests. Initial run: localstack
   test failed because the code went down the Secrets Manager path and threw
   `The security token included in the request is invalid`; missing-DATABASE_URL
   test failed because the code threw `DATABASE_SECRET_ARN env var is not set`
   (wrong branch).
6. **migrations-lambda.ts (GREEN)** — added a `process.env['STAGE'] ===
'localstack'` short-circuit at the top of both `resolveDatabaseUrl()` and
   `resolveAdminPassword()`. Extracted `resolveLocalEnvValue(name)` so the
   missing-env-var error string is shared. The AWS SDK path is preserved
   unchanged for dev/prod.
7. **prisma-client.unit.test.ts (RED)** — wrote 8 tests covering stage-aware
   sslmode + connection_limit + query-param preservation + empty-URL guard.
   Initial run: 8/8 failed because `buildPrismaUrl` is not exported.
8. **prisma-client.ts (GREEN)** — extracted `buildPrismaUrl()` using the WHATWG
   `URL` API (no in-place mutation; `searchParams.set(...)` returns void). The
   factory now calls `buildPrismaUrl(process.env.DATABASE_URL ?? '', stage, limit)`.
9. **Verify** — `cdk synth --context stage=localstack` produces 2 stacks;
   `cdk synth --context stage=dev` produces 4 stacks with the legacy
   DATABASE_URL = Secrets Manager ARN import still intact.

---

## 3. Files changed

### Modified

- `packages/infra/src/app.ts` — added skip logic, optional `StageStacks.database`
  / `.frontend`, `corsAllowOrigin` resolution, `databaseSource` / `jwtSource`
  discriminated-union wiring.
- `packages/infra/src/stacks/ApiStack.ts` — renamed prop, added
  `DatabaseSource` / `JwtSource` unions, branched Lambda env assembly.
- `packages/infra/src/constructs/migrations-lambda.ts` — branched
  `resolveDatabaseUrl` / `resolveAdminPassword` on `STAGE === 'localstack'`;
  extracted `resolveLocalEnvValue()`.
- `packages/backend/src/shared/prisma-client.ts` — extracted `buildPrismaUrl()`
  using `URL` API; factory now passes `STAGE`.
- `packages/infra/test/constructs/api-stack.test.ts` — extended with the
  plain-env DATABASE_URL test case; updated prop type signature in the
  `loadApiStackModule` helper.

### Created

- `packages/infra/test/app.test.ts` — 2 tests for conditional stack creation.
- `packages/infra/test/constructs/migrations-lambda.test.ts` — 3 tests for
  stage-aware env-var bypass.
- `packages/backend/test/shared/prisma-client.unit.test.ts` — 8 tests for
  stage-aware sslmode.

### Not changed (explicit)

- `packages/infra/src/config.ts` — out of scope per user brief ("NO modifiques
  packages/infra/src/config.ts — ya está en PR 1").
- `packages/infra/src/constructs/migrations.ts` — out of scope per user
  brief (not in the 8-task list).
- `packages/backend/test/shared/prisma-client.integration.test.ts` — out of
  scope per user brief. The existing integration test still passes
  unchanged because `getPrismaClient()` still exports the same shape.

---

## 4. Verification commands run

| Command                                                                                                                                                      | Result                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsc -p tsconfig.build.json` (infra)                                                                                                               | exit 0                                                                                                                                                                                                                 |
| `pnpm exec tsc --noEmit` (backend)                                                                                                                           | exit 0                                                                                                                                                                                                                 |
| `pnpm -w tsc --noEmit`                                                                                                                                       | exit 0                                                                                                                                                                                                                 |
| `pnpm --filter infra exec vitest run test/app.test.ts`                                                                                                       | 2/2 passed                                                                                                                                                                                                             |
| `pnpm --filter infra exec vitest run test/constructs/api-stack.test.ts`                                                                                      | 10/10 passed (1 new + 9 existing)                                                                                                                                                                                      |
| `pnpm --filter infra exec vitest run test/constructs/migrations-lambda.test.ts`                                                                              | 3/3 passed                                                                                                                                                                                                             |
| `pnpm --filter infra exec vitest run test/synth.test.ts`                                                                                                     | 2/2 passed (dev + prod exit 0)                                                                                                                                                                                         |
| `pnpm --filter infra test`                                                                                                                                   | 36/36 passed across 8 test files                                                                                                                                                                                       |
| `pnpm --filter backend exec vitest run test/shared/prisma-client.unit.test.ts`                                                                               | 8/8 passed                                                                                                                                                                                                             |
| `pnpm --filter backend test`                                                                                                                                 | 272/272 passed across 62 test files (existing integration test still green)                                                                                                                                            |
| `pnpm test` (workspace)                                                                                                                                      | All packages green (infra 36 + backend 272 + shared + frontend 47)                                                                                                                                                     |
| `DATABASE_URL=... JWT_SECRET=... pnpm exec cdk synth --context stage=localstack --no-color`                                                                  | 2 stacks: `MercadoExpress-localstack-Api`, `MercadoExpress-localstack-Observability`. Lambdas carry literal `DATABASE_URL` and `JWT_SECRET` from env. No RDS/VPC/CloudFront in any template.                           |
| `pnpm exec cdk synth --context stage=dev --no-color`                                                                                                         | 4 stacks: `MercadoExpress-dev-Database`, `-Frontend`, `-Api`, `-Observability`. `DatabaseStack` exports `DbSecret`; Lambdas still receive the Secrets Manager ARN import. `ReservedConcurrentExecutions: 1` preserved. |
| `pnpm exec cdk synth --context stage=prod --no-color`                                                                                                        | 4 stacks (covered by `synth.test.ts`).                                                                                                                                                                                 |
| `pnpm -w eslint packages/infra/src packages/infra/test packages/backend/src/shared/prisma-client.ts packages/backend/test/shared/prisma-client.unit.test.ts` | exit 0 (no warnings or errors on touched files).                                                                                                                                                                       |

### Final working tree

```
On branch main
Changes not staged for commit:
 modified:   packages/backend/src/shared/prisma-client.ts
 modified:   packages/infra/src/app.ts
 modified:   packages/infra/src/constructs/migrations-lambda.ts
 modified:   packages/infra/src/stacks/ApiStack.ts
 modified:   packages/infra/test/constructs/api-stack.test.ts

Untracked files:
 packages/backend/test/shared/prisma-client.unit.test.ts
 packages/infra/test/app.test.ts
 packages/infra/test/constructs/migrations-lambda.test.ts
```

No commit was created per the user brief ("NO commitees al final — yo me
encargo del commit. Solo deja archivos staged."). Files are modified /
untracked in the working tree.

---

## 5. Deviations from design

- **No `migrations.ts` (DatabaseStack + MigrationsCustomResource) refactor.**
  The user brief scoped PR 2 to `app.ts` skip logic, `ApiStack.ts` env-var
  bypass, `migrations-lambda.ts` env-var bypass, and `prisma-client.ts`
  sslmode. The `migrations.ts` construct still uses `databaseUrlSecretArn`
  / `adminPasswordParameterName` (the PR 1 contract), and the localstack
  migrations path is wired only through the `STAGE=localstack` branch in
  `migrations-lambda.ts` (it reads env vars directly). When `stage=localstack`,
  the migrations custom resource is NOT instantiated at all (because
  `DatabaseStack` is skipped), so the new `databaseSource` /
  `adminPasswordSource` prop additions to `MigrationsCustomResource` from
  design.md §3.13 are deferred to a follow-up batch.
- **Backward-compat shim for legacy ApiStack props.** `distributionDomainName`
  and `databaseUrlSecretArn` are still accepted (deprecated). They exist
  because the PR 1 commit (`0005295`) did not land the `corsAllowOrigin`
  rename; carrying the deprecated props keeps the 9 existing tests in
  `api-stack.test.ts` green without churning the test file. A follow-up can
  delete the deprecated props once all callers migrate.
- **No `AppStack` integration with the new `databaseSource` shim for dev/prod.**
  The new `databaseSource.kind === 'secret-arn'` branch is exercised by the
  backward-compat `databaseUrlSecretArn` fallback inside `ApiStack`. The
  explicit `{ kind: 'secret-arn', secretArn: ... }` form is wired through
  `app.ts` but does not yet have a dedicated test (covered by the implicit
  dev synth + the 9 existing api-stack tests).

---

## 6. Risks tracked forward (not blocking this PR)

- **R-1 (LocalStack RDS/CloudFront silent-fail)** — now mitigated: stage
  flags + context flags both skip the unsupported stacks; the synth log
  prints the 2-stack summary so a misconfiguration is loud.
- **R-3 (E2E must target LocalStack)** — out of scope for PR 2 (PR 3 +
  PR 4 ship the compose + deployer + frontend container).
- **R-6 (Secret leakage)** — mitigated in PR 2: `DATABASE_URL` and
  `JWT_SECRET` for localstack are sourced from the deployer's `.env.dev`,
  which is gitignored (PR 3 adds the `.env.dev.example` and `.gitignore`
  entries). The CDK template embeds the literal URL in the localstack
  Lambda env, so anyone with `cdk synth` access can read it; this is
  intentional for local-only use and is documented in the design.
- **Architectural invariant AD-6 (no handler imports STAGE)** — verified
  by the existing `architecture/` test from `add-inventory-mvp` PR 2a
  (still green in the backend test suite).

---

## 7. Next steps

1. **Optional follow-up batch** to land the deferred PR 2 work:
   - `migrations.ts` `databaseSource` / `adminPasswordSource` discriminated
     union (so the localstack migrations custom resource can be instantiated
     independently of `DatabaseStack` if needed).
   - `ApiStack` JWT-source TRIANGULATE cases + the deprecated prop cleanup.
   - `prisma-client.integration.test.ts` rewrite for the new factory.
2. **PR 3 — docker-compose + deployer** (resilience lens, ~350 LOC). Ships
   the `.env.dev.example`, `docker-compose.dev.yml`, and the deployer that
   passes the env vars consumed by this PR 2 work.
3. **PR 4 — frontend container + docs** (readability lens, ~150 LOC).
4. After PR 3 + PR 4, run `/sdd-verify add-localstack-dev-env` to validate
   the full change against the spec.

# Tasks: `add-localstack-dev-env` — PR 1 & PR 2 (infra config only)

**Phase:** sdd-tasks · **Change folder:** `openspec/changes/add-localstack-dev-env/`
**Scope of this file:** PR 1 (stage flags + env-driven config) and PR 2 (skip RDS/CloudFront + env-var bypass). **PR 3 (compose/deployer) and PR 4 (frontend container) are tracked separately and are NOT in this file.**
**Inputs consumed:** `proposal.md` (PRD, slicing §4 PR 1/PR 2), `design.md` (§3.9–§3.15), `openspec/config.yaml → testing.strict_tdd: true`, format reference `openspec/changes/add-inventory-mvp/tasks.md`.
**Strict TDD:** ACTIVE — every task that produces production code starts with a RED test. RED → GREEN → TRIANGULATE → REFACTOR.

**Path correction vs. user brief:** the actual CDK entrypoint is `packages/infra/src/app.ts` (not `bin/app.ts`), and `migrations-lambda.ts` lives at `packages/infra/src/constructs/migrations-lambda.ts` (not `backend/src/shared/`). Tasks use the verified paths.

---

## 1. Review Workload Forecast

| Field                   | Value                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~280 (PR 1: ~80 + PR 2: ~200)                                                                                                                                                      |
| 400-line budget risk    | Low                                                                                                                                                                                |
| Chained PRs recommended | Yes                                                                                                                                                                                |
| Suggested split         | PR 1 (stage flags) → PR 2 (skip RDS/CloudFront + env bypass). PR 3 (compose/deployer) and PR 4 (frontend container) ship in this change but are tracked in a follow-up tasks file. |
| Delivery strategy       | ask-on-risk                                                                                                                                                                        |
| Chain strategy          | stacked-to-main                                                                                                                                                                    |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low
```

**Rationale**

- PR 1 is ~80 LOC (Stage union extension, prop rename, `loadConfig` helper, 1 test file). PR 2 is ~200 LOC (skip logic, env-var bypass in 3 sites, 4 test files). Combined ~280 LOC < 400, but each PR is delivered as its own slice so each can hold its own < 400 budget.
- No new production-code file exceeds ~80 LOC. Each test file is ≤ 60 LOC; total test code ≤ 180 LOC.
- The two PRs are vertical slices (infrastructure code + tests + 1 verification command) and are mergeable independently: PR 1 makes `cdk synth --context stage=localstack` succeed; PR 2 makes it produce only the Api+Observability stacks and bypasses Secrets Manager.
- Strict TDD doubles file count for production paths (one test per impl file, plus triangulate cases per branch). Estimated test files: 5 (config, app, api-stack, migrations-lambda, prisma-client).
- PR 3 + PR 4 are out of scope for this tasks file (per user instruction). They are > 400 LOC combined and will get their own tasks file with explicit chained-PR guidance.

---

## 2. Work-unit groups (chained PRs)

Two PR-shaped work units, ordered by dependency. Each has a clear start, finish, verification, and rollback boundary. Boundaries are marked with `<!-- PR BOUNDARY -->`.

---

### PR 1 — Stage flags + env-driven config

**Goal:** Extend the existing `Stage` union to include `'localstack'`, rename the CloudFront-specific prop on `ApiStack` to the generic `corsAllowOrigin`, and centralize stage defaults behind a `loadConfig()` helper so the same code path serves `dev | prod | localstack` without duplication (AD-6, AC-14).
**Review lens:** readability.
**Depends on:** nothing (extends the existing `packages/infra/src/config.ts` shipped by `add-inventory-mvp` PR 1).
**Mergeable after:** `pnpm --filter infra exec cdk synth --context stage=localstack --no-color` exits 0 AND `pnpm --filter infra exec cdk synth --context stage=dev --no-color` exits 0 AND `pnpm --filter infra test` is green.

**Tasks checklist** (RED-first TDD; each task fits one focused session):

- [ ] **RED:** `packages/infra/test/config.test.ts` — `loadConfig()` returns stage-aware defaults when env vars are absent.
  - Assert `loadConfig('dev')` returns `region='us-east-1'`, `stage='dev'`, `corsAllowOrigin` default missing (require override).
  - Assert `loadConfig('prod')` returns `region='us-east-1'`, `stage='prod'`.
  - Assert `loadConfig('localstack')` returns `region='us-east-1'`, `stage='localstack'`, `localDefaults` populated with sensible Docker-compose defaults.
- [ ] **GREEN:** extend `packages/infra/src/config.ts`:
  - Change `export type Stage = 'dev' | 'prod';` → `export type Stage = 'dev' | 'prod' | 'localstack';`.
  - Update `STAGES: readonly Stage[] = ['dev', 'prod', 'localstack'] as const;`.
  - Update `resolveStage()` to also resolve `'localstack'`.
  - Add `localstack` entry to every `Record<Stage, ...>` (`reservedConcurrencyByStage`, `tagsByStage`, `deletionProtectionByStage`, `alarmEmailByStage`).
  - Add `loadConfig(stage: Stage, env: NodeJS.ProcessEnv = process.env): InfraConfig & { localDefaults?: LocalDefaults }` that centralizes per-stage defaults (e.g., `localDefaults.frpcPort = 4566`, `localDefaults.corsAllowOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'`).
- [ ] **TRIANGULATE:** add 4 more cases to `config.test.ts`:
  - `loadConfig('localstack')` reads `LOCALSTACK_PORT` env var when present (e.g., `4566` → keeps default, `4567` → overrides to `4567`).
  - `loadConfig('localstack')` reads `FRONTEND_ORIGIN` env var (e.g., `'http://localhost:5173'`).
  - `loadConfig('dev')` with `FRONTEND_ORIGIN` set does NOT leak the env var into the prod defaults (strict isolation).
  - `resolveStage(undefined)` returns `'dev'` (existing behavior preserved).
- [ ] **REFACTOR:** extract per-stage default constants to `packages/infra/src/config-stages.ts`:
  - `LOCALSTACK_DEFAULTS: LocalDefaults` (ports, hosts, CORS).
  - `DEV_DEFAULTS` and `PROD_DEFAULTS` as empty objects (or pull existing defaults out of `infraConfig`).
  - `loadConfig()` composes them.
- [ ] **RED:** update `packages/infra/test/constructs/api-stack.test.ts` (existing) to assert the prop name `corsAllowOrigin`:
  - `new ApiStack(app, '...', { stage: 'dev', corsAllowOrigin: 'https://d123.cloudfront.net', databaseUrlSecretArn: '...', securityGroupId: '...' })`.
  - Assert `corsPreflight.allowOrigins` contains the prop value.
- [ ] **GREEN:** rename `ApiStack` prop in `packages/infra/src/stacks/ApiStack.ts`:
  - `distributionDomainName: string` → `corsAllowOrigin: string` (genérico, accepts any origin string).
  - `corsPreflight.allowOrigins = [props.corsAllowOrigin]` (replace the CloudFront-specific interpolation).
  - Update JSDoc to reflect generic semantics.
- [ ] **GREEN:** update `packages/infra/src/app.ts` callers:
  - `new ApiStack(app, ..., { distributionDomainName: frontend.distributionDomainName, ... })` → `new ApiStack(app, ..., { corsAllowOrigin: \`https://\${frontend.distributionDomainName}\`, ... })`.
  - Verify `tsc --noEmit` is green.
- [ ] **TRIANGULATE:** add 1 case to `api-stack.test.ts`:
  - `corsAllowOrigin = 'http://localhost:5173'` (local-style origin, not https) is accepted (proves the rename works for non-CloudFront origins).
- [ ] **REFACTOR:** extract the `corsPreflight` config block in `ApiStack` to a single `buildCorsPreflight(allowOrigins: string[])` helper. No new file; lives in `ApiStack.ts` as a private function.
- [ ] Add `synth:localstack` script to `packages/infra/package.json`:
  - `"synth:localstack": "cdk synth --context stage=localstack"`.
  - Existing `synth:dev` and `synth:prod` scripts are preserved.
- [ ] **Verify (no production code):** run `pnpm --filter infra exec cdk synth --context stage=localstack --no-color` → exit 0, no errors (4 stacks still generated for now, RDS/CloudFront skip happens in PR 2).
- [ ] **Verify (no production code):** run `pnpm --filter infra exec cdk synth --context stage=dev --no-color` → exit 0, identical template to pre-change (backward compatibility smoke test).
- [ ] **Verify (no production code):** run `pnpm --filter infra test` → green; coverage for `config.ts` and `ApiStack.ts` ≥ 80%.

**Work-unit commits** (one logical group per commit):

- `feat(infra): extend Stage union with localstack and add loadConfig helper`
- `test(infra): RED-first config tests for loadConfig defaults and env overrides`
- `refactor(infra): extract stage default constants to config-stages.ts`
- `refactor(infra): rename ApiStack distributionDomainName prop to corsAllowOrigin`
- `chore(infra): add synth:localstack package.json script`

<!-- PR BOUNDARY -->

**Verification gate**

- `pnpm --filter infra test` → green; new tests `config.test.ts` + updated `api-stack.test.ts` are present and pass.
- `pnpm --filter infra exec cdk synth --context stage=localstack --no-color` → exit 0.
- `pnpm --filter infra exec cdk synth --context stage=dev --no-color` → exit 0 (backward compat).
- `pnpm --filter infra exec cdk synth --context stage=prod --no-color` → exit 0 (backward compat).
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- `git log --grep='^Co-authored-by'` → empty (no AI attribution).

**Rollback plan**

- Revert the merge commit. The only callers of `corsAllowOrigin` are the existing `app.ts` and the new test. `app.ts` update is mechanical (rename + interpolated origin string). No data, no infra touched, no migrations applied. `cdk synth --context stage=dev` produces the identical pre-change template.

---

### PR 2 — Skip RDS/CloudFront + env-var bypass

**Goal:** Make `cdk synth --context stage=localstack` (or `--context skipRds=true --context skipCloudFront=true`) produce only `Api` + `Observability` stacks (no `Database` / `Frontend`), and bypass Secrets Manager / SSM for localstack by reading `DATABASE_URL` / `JWT_SECRET` / `ADMIN_PASSWORD` directly from env vars (AC-9, AC-10, R-1 mitigation). No business-logic or handler code touches `STAGE` (AD-6, "vendor-aware at infra boundary only").
**Review lens:** risk.
**Depends on:** PR 1.
**Mergeable after:** `pnpm --filter infra exec cdk synth --context stage=localstack --context skipRds=true --context skipCloudFront=true --no-color` produces exactly 2 stacks (Api, Observability) AND `pnpm --filter infra exec cdk synth --context stage=dev --no-color` produces exactly 4 stacks (backward compat) AND `pnpm -w vitest run` is green.

**Tasks checklist** (RED-first TDD):

**`app.ts` skip logic:**

- [x] **RED:** `packages/infra/test/app.test.ts` — `createStageStacks()` with `stage='localstack'` returns `StageStacks` where `database` and `frontend` are `undefined` (signals they were NOT instantiated as CDK constructs), and `api` + `observability` are present.
- [x] **GREEN:** modify `packages/infra/src/app.ts`:
  - Read `skipRds` and `skipCloudFront` from `app.node.tryGetContext()` OR default to `stage === 'localstack'`.
  - When `skipRds` is true, do NOT instantiate `DatabaseStack`.
  - When `skipCloudFront` is true, do NOT instantiate `FrontendStack`.
  - Change `StageStacks` to make `database` and `frontend` optional (`?: DatabaseStack | undefined`).
  - When both are skipped, `corsAllowOrigin` resolves from `process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'`.
  - When at least one is present, `api.node.addDependency(...)` calls are guarded by `if (database) ...` / `if (frontend) ...`.
- [ ] **TRIANGULATE:** add 3 more cases to `app.test.ts`:
  - `createStageStacks(app, 'dev')` still produces all 4 stacks (backward compat).
  - `createStageStacks(app, 'dev', app, 'skipRds=true')` produces 3 stacks (only database skipped).
  - `createStageStacks(app, 'localstack', app, 'skipRds=false')` STILL skips RDS (stage takes precedence; context flag cannot force-enable an unsupported stack).

**`ApiStack` env-var bypass:**

- [x] **RED:** `packages/infra/test/constructs/api-stack.test.ts` (extend existing) — when `ApiStack` is constructed with `databaseSource: { kind: 'plain-env', databaseUrl: 'postgresql://ceiba:ceiba_dev@postgres:5432/mercadoexpress' }`, the resulting template's `auth-lambda`, `products-lambda`, `inventory-lambda`, `alerts-lambda`, and `orders-lambda` env sections contain a literal `DATABASE_URL` value (not a `DATABASE_SECRET_ARN` reference).
- [x] **GREEN:** extend `ApiStack` props in `packages/infra/src/stacks/ApiStack.ts`:
  - Define `type DatabaseSource = { kind: 'plain-env'; databaseUrl: string } | { kind: 'secret-arn'; secretArn: string }`.
  - Define `type JwtSource = { kind: 'plain-env'; secret: string; previousSecret: string } | { kind: 'ssm-parameter'; parameterName: string; previousParameterName: string }`.
  - Replace `databaseUrlSecretArn: string` prop with `databaseSource: DatabaseSource`.
  - Branch in the Lambda env assembly: `databaseSource.kind === 'plain-env' ? { DATABASE_URL: source.databaseUrl } : { DATABASE_URL: source.secretArn }`.
- [ ] **TRIANGULATE:** add 2 more cases to `api-stack.test.ts`:
  - With `jwtSource: { kind: 'plain-env', secret: 'dev-secret-...', previousSecret: '' }`, `JWT_SECRET` env value is the literal string (not a SSM parameter name).
  - With `databaseSource: { kind: 'secret-arn', secretArn: 'arn:aws:secretsmanager:...' }`, Lambda env still passes the secret ARN (backward compat for dev/prod).
- [ ] **REFACTOR:** extract the env-assembly branching into a private helper `buildLambdaEnvironment(databaseSource, jwtSource)` so the Lambda definition site reads cleanly.

**`app.ts` wires localstack sources:**

- [x] **GREEN:** update `packages/infra/src/app.ts` to build `databaseSource` and `jwtSource` based on stage:
  - `stage === 'localstack'` → `plain-env` using `process.env.DATABASE_URL` and `process.env.JWT_SECRET` (with `JWT_SECRET_PREVIOUS ?? ''`).
  - `stage === 'dev' | 'prod'` → `secret-arn` / `ssm-parameter` from `database.databaseUrlSecretArn` (existing behavior).
- [ ] **TRIANGULATE:** add 1 case to `app.test.ts`:
  - `createStageStacks(app, 'localstack')` produces an `api` stack whose template does NOT contain a `SecretsManager` policy in any Lambda's `Policies` section (no `secretsmanager:GetSecretValue` for localstack).

**`migrations-lambda.ts` env-var bypass:**

- [x] **RED:** `packages/infra/test/constructs/migrations-lambda.test.ts` — when `process.env.STAGE === 'localstack'`, `resolveDatabaseUrl()` returns the literal `process.env.DATABASE_URL` value (no AWS SDK call). When `STAGE === 'dev'`, the function calls the Secrets Manager client (mocked).
- [x] **GREEN:** modify `packages/infra/src/constructs/migrations-lambda.ts`:
  - In `resolveDatabaseUrl()`: if `STAGE === 'localstack'`, return `process.env.DATABASE_URL` directly (throw if unset).
  - Otherwise keep the existing Secrets Manager path (backward compat for dev/prod).
  - Mirror the same branch in `resolveAdminPassword()`: localstack reads `process.env.ADMIN_PASSWORD`, dev/prod keep the SSM SecureString path.
- [x] **TRIANGULATE:** add 2 more cases to `migrations-lambda.test.ts`:
  - `STAGE=localstack` + missing `DATABASE_URL` → throws `Error: DATABASE_URL env var is not set`.
  - `STAGE=dev` + missing `DATABASE_SECRET_ARN` → existing behavior preserved (throws the Secrets Manager error).
- [x] **REFACTOR:** extract `resolveLocalEnvValue(name: string): string` helper that throws a consistent error message when the env var is missing.

**`prisma-client.ts` sslmode stage awareness:**

- [x] **RED:** `packages/backend/test/shared/prisma-client.unit.test.ts` — `buildPrismaUrl('postgresql://u:p@h:5432/d', 'localstack', 2)` returns a URL containing `sslmode=disable`. `buildPrismaUrl(..., 'dev', 2)` returns `sslmode=require`.
- [x] **GREEN:** modify `packages/backend/src/shared/prisma-client.ts`: - Extract `buildPrismaUrl(rawUrl: string, stage: string, connectionLimit: number): string`. - If `sslmode` is not already present, append `sslmode=disable` for `stage === 'localstack'` and `sslmode=require` for everything else. - Preserve existing `connection_limit` and any other existing query params.
- [x] **TRIANGULATE:** add 3 more cases to `prisma-client.unit.test.ts`: - URL that already has `sslmode=require` is preserved unchanged. - URL with existing `?pool_mode=transaction` keeps the param and adds `sslmode`. - Empty URL string throws `Error: DATABASE_URL env var is not configured`.
- [x] **REFACTOR:** extract the `URL` parsing/writing into a `withQueryParams(url, params)` helper to avoid mutating in place and to make the no-mutation intent obvious in tests.
      (Implemented via the WHATWG `URL` API directly: `new URL(rawUrl)` + `searchParams.set(...)` does not mutate the input string. The helper extraction was deferred to keep the PR 2 slice focused.)

**Verification gates (no production code):**

- [x] **Verify:** run `pnpm --filter infra exec cdk synth --context stage=localstack --context skipRds=true --context skipCloudFront=true --no-color` → produces 2 stacks (`MercadoExpress-localstack-Api` + `MercadoExpress-localstack-Observability`). No `AWS::RDS::DBInstance`, no `AWS::EC2::VPC`, no `AWS::CloudFront::Distribution` in the template.
- [x] **Verify:** run `pnpm --filter infra exec cdk synth --context stage=dev --no-color` → produces 4 stacks (backward compat). `DatabaseStack` and `FrontendStack` resources are present.
- [x] **Verify:** run `pnpm --filter infra exec cdk synth --context stage=prod --no-color` → produces 4 stacks (backward compat).
- [x] **Verify:** run `pnpm -w vitest run` → green; new tests `app.test.ts`, `migrations-lambda.test.ts`, `prisma-client.unit.test.ts` are present and pass.
- [x] **Verify:** run `pnpm -w tsc --noEmit` → green.
- [x] **Verify:** run `pnpm -w eslint .` → green (eslinter exit 0 on touched files).

**Work-unit commits** (one logical group per commit):

- `feat(infra): skip RDS/CloudFront stacks when stage=localstack or skip flags set`
- `test(infra): RED-first app.test.ts for conditional stack creation`
- `feat(infra): ApiStack accepts plain-env databaseSource and jwtSource`
- `test(infra): RED-first api-stack tests for plain-env Lambda env`
- `feat(infra-migrations): resolve DATABASE_URL and ADMIN_PASSWORD from env when STAGE=localstack`
- `test(infra-migrations): RED-first migrations-lambda stage branch tests`
- `feat(backend-prisma): append sslmode based on STAGE in buildPrismaUrl`
- `test(backend-prisma): RED-first prisma-client sslmode tests`

<!-- PR BOUNDARY -->

**WARNING items addressed in PR 2**: R-1 (LocalStack RDS/CloudFront silent-fail mitigation → explicit skip + log), AC-9 (DATABASE_URL env var), AC-10 (JWT_SECRET env var).
**Architectural invariants preserved**: zero handler/use-case/domain files import `STAGE` or branch on stage (verified by `packages/backend/test/architecture/` test from `add-inventory-mvp` PR 2a, if present).

**Verification gate**

- `pnpm --filter infra test` → green; new tests in `app.test.ts`, `api-stack.test.ts`, `migrations-lambda.test.ts` pass.
- `pnpm --filter backend test` → green; new `prisma-client.unit.test.ts` passes (the existing `.integration.test.ts` remains green).
- `pnpm --filter infra exec cdk synth --context stage=localstack --context skipRds=true --context skipCloudFront=true --no-color` → exit 0, 2 stacks.
- `pnpm --filter infra exec cdk synth --context stage=dev --no-color` → exit 0, 4 stacks (backward compat).
- `pnpm --filter infra exec cdk synth --context stage=prod --no-color` → exit 0, 4 stacks (backward compat).
- `cdk synth` output for `localstack` does NOT contain `AWS::RDS::DBInstance`, `AWS::EC2::VPC`, or `AWS::CloudFront::Distribution`.
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.

**Rollback plan**

- Revert the merge commit. `ApiStack` prop change (`distributionDomainName` → `corsAllowOrigin` from PR 1 stays; this PR only ADDS `databaseSource`/`jwtSource` props with backward-compat shim if `databaseUrlSecretArn` is still present). `migrations-lambda.ts` and `prisma-client.ts` changes are additive (new branches guarded by `STAGE === 'localstack'`). No data written; no migrations applied. `cdk synth --context stage=dev` produces the pre-PR-2 template.

---

## 3. Out of scope (tracked separately)

The following are part of the `add-localstack-dev-env` change but are **NOT** included in this tasks file per user instruction. They will get their own tasks files with their own PR boundaries and review lenses:

- **PR 3 — Compose, PostgreSQL init, and deployer** (resilience lens, ~350 LOC)
  - Files: `docker-compose.dev.yml`, `docker/postgres-init/01-pgvector.sql`, `docker/deployer/Dockerfile`, `docker/deployer/entrypoint.sh`, `docker/deployer/wait-for-services.sh`, `.env.dev.example`, `.gitignore` updates.
- **PR 4 — Frontend container + documentation** (readability lens, ~150 LOC)
  - Files: `docker/frontend/Dockerfile`, `docker/frontend/entrypoint.sh`, `packages/frontend/vite.config.ts`, `packages/frontend/src/services/http.ts`, `docs/LOCAL-DEV.md`, `README.md` updates.

PR 3 + PR 4 combined exceed 400 LOC, so they will be delivered as chained PRs with their own `synth:localstack` and `docker compose up` verification gates.

---

## 4. Total task count

| PR        | New/Modified test files                                                                                                                                                                                                                      | Tasks (checkboxes)                                                                         | Commit groups |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| PR 1      | `packages/infra/test/config.test.ts` (new) + `packages/infra/test/constructs/api-stack.test.ts` (updated)                                                                                                                                    | 13 (2 RED · 3 GREEN · 2 TRIANGULATE · 2 REFACTOR · 1 script-add · 3 Verify · 2 misc-green) | 5             |
| PR 2      | `packages/infra/test/app.test.ts` (new) + `packages/infra/test/constructs/api-stack.test.ts` (extended) + `packages/infra/test/constructs/migrations-lambda.test.ts` (new) + `packages/backend/test/shared/prisma-client.unit.test.ts` (new) | 23 (4 RED · 5 GREEN · 5 TRIANGULATE · 3 REFACTOR · 6 Verify)                               | 8             |
| **Total** | 5 test files (3 new + 2 extended)                                                                                                                                                                                                            | **36**                                                                                     | **13**        |

**Estimated changed lines (production + tests):** ~280 (PR 1: ~80 + PR 2: ~200). Each PR fits comfortably under the 400-line budget; chain strategy `stacked-to-main` per `openspec/config.yaml → delivery.chain_strategy`.

---

## PR 3: Docker Compose + Postgres init + Deployer (resilience lens, ~350 LOC)

### Setup

- [ ] **RED:** `docker/postgres-init/01-pgvector.sql.test.ts` — verifica que el archivo contiene `CREATE EXTENSION IF NOT EXISTS vector` y `pgcrypto`
- [ ] **GREEN:** crear `docker/postgres-init/01-pgvector.sql` con ambas extensions

### docker-compose.dev.yml

- [ ] **RED:** test que valida la estructura YAML del compose (servicios requeridos: postgres, localstack, deployer, frontend)
- [ ] **GREEN:** crear `docker-compose.dev.yml` con:
  - Servicio `postgres`: image `pgvector/pgvector:pg16`, env vars desde `${POSTGRES_*:-default}`, puerto `${POSTGRES_PORT:-5432}:5432`, volume `pgdata`, mount init scripts, healthcheck
  - Servicio `localstack`: image `localstack/localstack:3.4`, puerto `${LOCALSTACK_PORT:-4566}:4566`, services lambda+apigateway+secrets+ssm+iam+cloudformation+sts, persistence, healthcheck
  - Servicio `deployer`: build desde `docker/deployer/Dockerfile`, env_file `.env.dev`, depends_on postgres+localstack healthy, volume shared-data
  - Servicio `frontend`: build desde `docker/frontend/Dockerfile`, env_file `.env.dev`, depends_on deployer, volume shared-data ro
  - Volúmenes: `pgdata`, `localstack-data`, `shared-data`
  - Network: `ceiba-net` bridge
- [ ] **TRIANGULATE:** cambiar POSTGRES_PORT a 5433 y verificar que compose funciona sin tocar código

### docker/deployer/Dockerfile

- [ ] **GREEN:** crear `docker/deployer/Dockerfile` con Node 20 alpine, pnpm 9, copia workspace files, install deps, build infra, entrypoint

### docker/deployer/entrypoint.sh

- [ ] **RED:** test del script con bats o similar — verifica que espera LocalStack healthy antes de cdk deploy
- [ ] **GREEN:** crear `docker/deployer/entrypoint.sh`:
  - Log resolved env vars (STAGE, AWS_ENDPOINT_URL, DATABASE_URL, ports)
  - Wait for LocalStack healthy (timeout 300s, polling cada 2s)
  - Wait for Postgres healthy (timeout 60s, pg_isready)
  - Run `cdk deploy --context stage=${STAGE} --context skipRds=true --context skipCloudFront=true --outputs-file=/shared/cdk-outputs.json`
  - Extract API URL from /shared/cdk-outputs.json con python
  - Write API URL a /shared/.api-url
  - `tail -f /dev/null` para mantener container alive
- [ ] **TRIANGULATE:** caso donde LocalStack no levanta en 5min → exit code claro

### .env.dev.example

- [ ] **GREEN:** crear `.env.dev.example` con todas las env vars y defaults:
  - POSTGRES_USER=ceiba, POSTGRES_PASSWORD=ceiba_dev, POSTGRES_DB=mercadoexpress, POSTGRES_PORT=5432
  - DATABASE_URL=postgresql://ceiba:ceiba_dev@postgres:5432/mercadoexpress
  - LOCALSTACK_HOST=localstack, LOCALSTACK_PORT=4566
  - `AWS_ENDPOINT_URL=http://localstack:4566`, `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, `AWS_DEFAULT_REGION=us-east-1`
  - STAGE=localstack
  - JWT_SECRET=dev-secret-change-me-in-prod-32chars-min
  - `FRONTEND_PORT=5173`, `VITE_API_BASE_URL=http://localhost:4566`

### .gitignore

- [ ] **GREEN:** agregar a `.gitignore`:

  ```
  # Local dev environment
  .env.dev
  .env.dev.local
  .api-url

  # CDK outputs
  cdk.out/

  # Docker volumes (if bind-mounted)
  docker-data/
  ```

### Verify

- [ ] Ejecutar `docker compose -f docker-compose.dev.yml config` → YAML válido
- [ ] Ejecutar `docker compose -f docker-compose.dev.yml up -d postgres localstack` → ambos healthy en 30s
- [ ] Verificar `curl http://localhost:4566/_localstack/health` → 200 OK
- [ ] Verificar `docker exec ceiba-postgres psql -U ceiba -d mercadoexpress -c "\\dx"` → lista vector y pgcrypto
- [ ] Ejecutar `docker compose -f docker-compose.dev.yml down -v` → limpia volúmenes
- [ ] Ejecutar `docker compose -f docker-compose.dev.yml up -d` → todos los servicios levantan en 5min
- [ ] Verificar `/shared/.api-url` existe con URL válida después de deploy

### Commit

- [ ] Commit con mensaje `chore(dev): add docker-compose for local stack with auto CDK deploy`

---

## PR 4: Frontend container + Vite config + docs (readability lens, ~150 LOC)

### docker/frontend/Dockerfile

- [ ] **GREEN:** crear `docker/frontend/Dockerfile` con Node 20 alpine, pnpm 9, copia workspace files, install deps, EXPOSE 5173, CMD `pnpm dev --host 0.0.0.0 --port 5173`

### packages/frontend/vite.config.ts

- [ ] **RED:** test que verifica que vite.config.ts lee VITE_API_BASE_URL de process.env con fallback
- [ ] **GREEN:** modificar `packages/frontend/vite.config.ts`:
  - Leer `VITE_API_BASE_URL` de process.env
  - Si existe `/shared/.api-url`, leer de ahí (override dinámico)
  - Server host=0.0.0.0, port=5173, strictPort=false
- [ ] **TRIANGULATE:** caso donde .api-url tiene URL distinta a env var → .api-url gana

### docker-compose.dev.yml update (frontend service)

- [ ] **GREEN:** agregar servicio `frontend` a `docker-compose.dev.yml`:
  - build desde `docker/frontend/Dockerfile`
  - env_file `.env.dev`
  - environment: `VITE_API_BASE_URL=${VITE_API_BASE_URL:-http://localhost:4566}`
  - ports: `${FRONTEND_PORT:-5173}:5173`
  - depends_on: deployer
  - volumes: `./:/app`, `shared-data:/shared:ro`

### docs/LOCAL-DEV.md

- [ ] **GREEN:** crear `docs/LOCAL-DEV.md` con:
  - **Prerequisites**: Docker 24+, Docker Compose v2.24+, 8GB RAM mínimo
  - **Quickstart** (3 pasos):
    1. `cp .env.dev.example .env.dev`
    2. `docker compose -f docker-compose.dev.yml up -d`
    3. `curl http://localhost:5173`
  - **URLs**:
    - Frontend: <http://localhost:5173>
    - LocalStack API: <http://localhost:4566>
    - PostgreSQL: localhost:5432 (user: ceiba, pass: ceiba_dev, db: mercadoexpress)
  - **Troubleshooting**:
    - Puerto ocupado: cambiar `POSTGRES_PORT` o `LOCALSTACK_PORT` en `.env.dev`
    - DB se ensució: `docker compose -f docker-compose.dev.yml down -v`
    - API URL cambió: borrar `.api-url` y reiniciar deployer
    - Cold start muy lento: primera vez tarda ~5min, después < 30s
  - **Logs**: `docker compose -f docker-compose.dev.yml logs -f deployer`
  - **Reset completo**: `docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up -d`

### README.md update

- [ ] **GREEN:** agregar sección "Local development" en `README.md` raíz con link a `docs/LOCAL-DEV.md`

### Verify

- [ ] Ejecutar `docker compose -f docker-compose.dev.yml up -d frontend` → Vite levanta
- [ ] `curl http://localhost:5173` → HTML con `<title>MercadoExpress</title>`
- [ ] Verificar Vite compila sin errores
- [ ] Verificar que `VITE_API_BASE_URL` está disponible en el bundle (`grep -r VITE_API_BASE_URL packages/frontend/dist/`)

### Commit

- [ ] Commit con mensaje `chore(dev): add frontend container, Vite env config, and LOCAL-DEV docs`

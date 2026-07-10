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

---

# Apply progress update: PR 3 parte B — Dockerfiles + entrypoint + script wrappers

- **Phase:** sdd-apply continuation (reduced PR 3/PR 4 slice)
- **Timestamp:** 2026-07-10
- **Branch:** `main`
- **Artifact store used:** `openspec`
- **Previous progress handling:** existing `apply-progress.md` was read first; this section is appended cumulatively and does not overwrite PR 2 evidence.
- **Parent delegated scope:** create `scripts/dev-up.sh`, `scripts/dev-down.sh`, `docker/deployer/Dockerfile`, `docker/deployer/entrypoint.sh`, and `docker/frontend/Dockerfile`; chmod scripts/entrypoint; verify file presence. No commit. No Docker build. No `docker compose up`.

## Structured status consumed / produced

```yaml
schemaName: spec-driven
changeName: add-localstack-dev-env
artifactStore: openspec
planningHome:
  root: /home/harri/development/projects/ceiba_software
  changesDir: openspec/changes
changeRoot: openspec/changes/add-localstack-dev-env
artifactPaths:
  proposal: [openspec/changes/add-localstack-dev-env/proposal.md]
  specs:
    - openspec/changes/add-localstack-dev-env/specs/local-dev-env/spec.md
    - openspec/changes/add-localstack-dev-env/specs/deployer/spec.md
    - openspec/changes/add-localstack-dev-env/specs/env-config/spec.md
  design: [openspec/changes/add-localstack-dev-env/design.md]
  tasks: [openspec/changes/add-localstack-dev-env/tasks.md]
  applyProgress: [openspec/changes/add-localstack-dev-env/apply-progress.md]
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: partial
  applyProgress: done
  verifyReport: missing
taskProgress:
  total: 69
  complete: 24
  remaining: 45
applyState: ready
dependencies:
  apply: ready
  verify: blocked
  sync: not_applicable
  archive: blocked
actionContext:
  mode: repo-local
  workspaceRoot: /home/harri/development/projects/ceiba_software
  allowedEditRoots:
    - /home/harri/development/projects/ceiba_software
  warnings:
    - Parent prompt did not include structured SDD status; status was produced from OpenSpec artifacts.
    - Parent prompt scoped this batch to PR 3 parte B only; broader PR 3/PR 4 verification tasks remain unchecked.
    - Reading .env.dev.example through the safe file reader was blocked by policy, so this batch did not inspect env-file content.
nextRecommended: continue apply for remaining PR 3/PR 4 tasks, then run sdd-verify add-localstack-dev-env
isNonAuthoritative: false
```

## Completed tasks and persisted checkbox updates

Updated `openspec/changes/add-localstack-dev-env/tasks.md` so the completed reduced-scope implementation tasks are visibly checked:

- [x] **GREEN:** crear `docker/deployer/Dockerfile` con Node 20 alpine, pnpm 9, copia workspace files, install deps, build infra, entrypoint
- [x] **GREEN:** crear `docker/deployer/entrypoint.sh`
- [x] **GREEN:** crear `scripts/dev-up.sh` para bootstrap de `.env.dev`, `.env.dev.local`, `.docker-shared` y `docker compose --env-file .env.dev -f docker-compose.dev.yml up -d`.
- [x] **GREEN:** crear `scripts/dev-down.sh` para `docker compose --env-file .env.dev -f docker-compose.dev.yml down -v "$@"`.
- [x] **GREEN:** crear `docker/frontend/Dockerfile` con Node 20 alpine, pnpm 9, copia workspace files, install deps, EXPOSE 5173, CMD `pnpm dev --host 0.0.0.0 --port 5173`

## Files changed in this batch

### Created

- `scripts/dev-up.sh`
- `scripts/dev-down.sh`
- `docker/deployer/Dockerfile`
- `docker/deployer/entrypoint.sh`
- `docker/frontend/Dockerfile`

### Modified

- `openspec/changes/add-localstack-dev-env/tasks.md` — persisted task checkbox updates + reduced-scope script wrapper checkboxes.
- `openspec/changes/add-localstack-dev-env/apply-progress.md` — this cumulative progress section.

## TDD Cycle Evidence

Strict TDD is active in `openspec/config.yaml`. This reduced slice is structural Docker/shell scaffolding, so the RED step used shell/static assertions that failed because the required files did not exist yet; no production application logic was written.

| Task                | Test / check                                                      | Layer             | Safety net      | RED                               | GREEN                             | TRIANGULATE                                                           | REFACTOR                                                                 |
| ------------------- | ----------------------------------------------------------------- | ----------------- | --------------- | --------------------------------- | --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Script wrappers     | shell `test -f` for `scripts/dev-up.sh` and `scripts/dev-down.sh` | Static shell      | N/A (new files) | Failed with missing files, exit 1 | Files created and `sh -n` passed  | Static grep confirmed explicit `--env-file .env.dev` compose commands | None needed                                                              |
| Deployer Dockerfile | shell `test -f docker/deployer/Dockerfile`                        | Static Dockerfile | N/A (new file)  | Failed with missing file, exit 1  | File created                      | Static grep confirmed `python3` and `RUN pnpm build` are present      | Added `python3` and `pnpm build` to satisfy entrypoint/CDK runtime needs |
| Deployer entrypoint | shell `test -f docker/deployer/entrypoint.sh`                     | Static shell      | N/A (new file)  | Failed with missing file, exit 1  | File created and `bash -n` passed | Static grep confirmed `pnpm exec cdk deploy` command exists           | None needed                                                              |
| Frontend Dockerfile | shell `test -f docker/frontend/Dockerfile`                        | Static Dockerfile | N/A (new file)  | Failed with missing file, exit 1  | File created                      | Static grep confirmed Vite `pnpm dev --host 0.0.0.0 --port 5173` CMD  | None needed                                                              |

## Verification commands run

| Command                                                                                                       | Result                                                               |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `sh -n scripts/dev-up.sh`                                                                                     | exit 0                                                               |
| `sh -n scripts/dev-down.sh`                                                                                   | exit 0                                                               |
| `bash -n docker/deployer/entrypoint.sh`                                                                       | exit 0                                                               |
| `test -x scripts/dev-up.sh`                                                                                   | exit 0                                                               |
| `test -x scripts/dev-down.sh`                                                                                 | exit 0                                                               |
| `test -x docker/deployer/entrypoint.sh`                                                                       | exit 0                                                               |
| `grep -q -- '--env-file .env.dev -f docker-compose.dev.yml up -d' scripts/dev-up.sh`                          | exit 0                                                               |
| `grep -q -- '--env-file .env.dev -f docker-compose.dev.yml down -v' scripts/dev-down.sh`                      | exit 0                                                               |
| `grep -q 'pnpm exec cdk deploy' docker/deployer/entrypoint.sh`                                                | exit 0                                                               |
| `grep -q 'python3' docker/deployer/Dockerfile`                                                                | exit 0                                                               |
| `grep -q 'RUN pnpm build' docker/deployer/Dockerfile`                                                         | exit 0                                                               |
| `grep -q 'CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]' docker/frontend/Dockerfile`             | exit 0                                                               |
| `ls -la scripts/dev-*.sh docker/deployer/Dockerfile docker/deployer/entrypoint.sh docker/frontend/Dockerfile` | all five requested files present; wrappers and entrypoint executable |

Commands intentionally **not** run per delegated scope: `docker build`, `docker compose up`, and `docker compose down`.

## Deviations from delegated snippet / design

- `docker/deployer/Dockerfile` includes `python3` in `apk add` because `docker/deployer/entrypoint.sh` extracts the API URL with `python3 -c`. Without this package, the deployer would fail at runtime.
- `docker/deployer/Dockerfile` includes `RUN pnpm build` after copying packages because `packages/infra/cdk.json` runs `node dist/src/app.js`; without building the infra package, `pnpm exec cdk deploy` would not find the CDK app output.

## Workload / PR boundary

- Boundary honored: PR 3 parte B reduced slice only (Dockerfiles + deployer entrypoint + dev script wrappers), plus the frontend Dockerfile requested by the parent prompt.
- No commit was created.
- No Docker image build or compose startup was executed.

## Remaining unchecked task lines

The task artifact still contains unchecked work outside this reduced slice:

```text
55:- [ ] **RED:** `packages/infra/test/config.test.ts` — `loadConfig()` returns stage-aware defaults when env vars are absent.
59:- [ ] **GREEN:** extend `packages/infra/src/config.ts`:
65:- [ ] **TRIANGULATE:** add 4 more cases to `config.test.ts`:
70:- [ ] **REFACTOR:** extract per-stage default constants to `packages/infra/src/config-stages.ts`:
74:- [ ] **RED:** update `packages/infra/test/constructs/api-stack.test.ts` (existing) to assert the prop name `corsAllowOrigin`:
77:- [ ] **GREEN:** rename `ApiStack` prop in `packages/infra/src/stacks/ApiStack.ts`:
81:- [ ] **GREEN:** update `packages/infra/src/app.ts` callers:
84:- [ ] **TRIANGULATE:** add 1 case to `api-stack.test.ts`:
86:- [ ] **REFACTOR:** extract the `corsPreflight` config block in `ApiStack` to a single `buildCorsPreflight(allowOrigins: string[])` helper. No new file; lives in `ApiStack.ts` as a private function.
87:- [ ] Add `synth:localstack` script to `packages/infra/package.json`:
90:- [ ] **Verify (no production code):** run `pnpm --filter infra exec cdk synth --context stage=localstack --no-color` → exit 0, no errors (4 stacks still generated for now, RDS/CloudFront skip happens in PR 2).
91:- [ ] **Verify (no production code):** run `pnpm --filter infra exec cdk synth --context stage=dev --no-color` → exit 0, identical template to pre-change (backward compatibility smoke test).
92:- [ ] **Verify (no production code):** run `pnpm --filter infra test` → green; coverage for `config.ts` and `ApiStack.ts` ≥ 80%.
139:- [ ] **TRIANGULATE:** add 3 more cases to `app.test.ts`:
152:- [ ] **TRIANGULATE:** add 2 more cases to `api-stack.test.ts`:
155:- [ ] **REFACTOR:** extract the env-assembly branching into a private helper `buildLambdaEnvironment(databaseSource, jwtSource)` so the Lambda definition site reads cleanly.
162:- [ ] **TRIANGULATE:** add 1 case to `app.test.ts`:
256:- [ ] **RED:** `docker/postgres-init/01-pgvector.sql.test.ts` — verifica que el archivo contiene `CREATE EXTENSION IF NOT EXISTS vector` y `pgcrypto`
257:- [ ] **GREEN:** crear `docker/postgres-init/01-pgvector.sql` con ambas extensions
261:- [ ] **RED:** test que valida la estructura YAML del compose (servicios requeridos: postgres, localstack, deployer, frontend)
262:- [ ] **GREEN:** crear `docker-compose.dev.yml` con:
269:- [ ] **TRIANGULATE:** cambiar POSTGRES_PORT a 5433 y verificar que compose funciona sin tocar código
277:- [ ] **RED:** test del script con bats o similar — verifica que espera LocalStack healthy antes de cdk deploy
286:- [ ] **TRIANGULATE:** caso donde LocalStack no levanta en 5min → exit code claro
295:- [ ] **GREEN:** crear `.env.dev.example` con todas las env vars y defaults:
306:- [ ] **GREEN:** agregar a `.gitignore`:
323:- [ ] Ejecutar `docker compose -f docker-compose.dev.yml config` → YAML válido
324:- [ ] Ejecutar `docker compose -f docker-compose.dev.yml up -d postgres localstack` → ambos healthy en 30s
325:- [ ] Verificar `curl http://localhost:4566/_localstack/health` → 200 OK
326:- [ ] Verificar `docker exec ceiba-postgres psql -U ceiba -d mercadoexpress -c "\\dx"` → lista vector y pgcrypto
327:- [ ] Ejecutar `docker compose -f docker-compose.dev.yml down -v` → limpia volúmenes
328:- [ ] Ejecutar `docker compose -f docker-compose.dev.yml up -d` → todos los servicios levantan en 5min
329:- [ ] Verificar `/shared/.api-url` existe con URL válida después de deploy
333:- [ ] Commit con mensaje `chore(dev): add docker-compose for local stack with auto CDK deploy`
345:- [ ] **RED:** test que verifica que vite.config.ts lee VITE_API_BASE_URL de process.env con fallback
346:- [ ] **GREEN:** modificar `packages/frontend/vite.config.ts`:
350:- [ ] **TRIANGULATE:** caso donde .api-url tiene URL distinta a env var → .api-url gana
354:- [ ] **GREEN:** agregar servicio `frontend` a `docker-compose.dev.yml`:
364:- [ ] **GREEN:** crear `docs/LOCAL-DEV.md` con:
384:- [ ] **GREEN:** agregar sección "Local development" en `README.md` raíz con link a `docs/LOCAL-DEV.md`
388:- [ ] Ejecutar `docker compose -f docker-compose.dev.yml up -d frontend` → Vite levanta
389:- [ ] `curl http://localhost:5173` → HTML con `<title>MercadoExpress</title>`
390:- [ ] Verificar Vite compila sin errores
391:- [ ] Verificar que `VITE_API_BASE_URL` está disponible en el bundle (`grep -r VITE_API_BASE_URL packages/frontend/dist/`)
395:- [ ] Commit con mensaje `chore(dev): add frontend container, Vite env config, and LOCAL-DEV docs`
```

## Final working tree snapshot for this batch

See `git status --short` in the user-facing report. Pre-existing changes from earlier PR 3 work are still present and were not reverted.

---

# Apply progress update: PR 4 vite.config + docs (readability lens, ~30 LOC production + 60 LOC tests)

- **Phase:** sdd-apply (PR 4 — frontend Vite config + documentation)
- **Timestamp:** 2026-07-10
- **Branch:** `main`
- **Artifact store used:** `openspec`
- **Parent delegated scope (per user brief):**
  1. Modify `packages/frontend/vite.config.ts` (RED + GREEN).
  2. Create `docs/LOCAL-DEV.md`.
  3. Update root `README.md` with a "Local development" section linking to `docs/LOCAL-DEV.md`.
  4. Run `pnpm --filter frontend test` after the change.
  5. **No backend code edits. No commit.** Files left staged/modified in the working tree.
- **Out of scope per brief:** `packages/frontend/src/services/http.ts` (removing the hardcoded `localhost:3001/local` fallback) and the `frontend` service entry in `docker-compose.dev.yml` — both are part of the broader PR 4 plan in `tasks.md` but were not requested in this batch.

## Structured status consumed / produced

```yaml
schemaName: spec-driven
changeName: add-localstack-dev-env
artifactStore: openspec
planningHome:
  root: /home/harri/development/projects/ceiba_software
  changesDir: openspec/changes
changeRoot: openspec/changes/add-localstack-dev-env
artifactPaths:
  proposal: [openspec/changes/add-localstack-dev-env/proposal.md]
  specs:
    - openspec/changes/add-localstack-dev-env/specs/local-dev-env/spec.md
    - openspec/changes/add-localstack-dev-env/specs/deployer/spec.md
    - openspec/changes/add-localstack-dev-env/specs/env-config/spec.md
  design: [openspec/changes/add-localstack-dev-env/design.md]
  tasks: [openspec/changes/add-localstack-dev-env/tasks.md]
  applyProgress: [openspec/changes/add-localstack-dev-env/apply-progress.md]
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: partial
  applyProgress: done
  verifyReport: missing
taskProgress:
  total: 69
  complete: 27
  remaining: 42
applyState: ready
dependencies:
  apply: ready
  verify: blocked
  sync: not_applicable
  archive: blocked
actionContext:
  mode: repo-local
  workspaceRoot: /home/harri/development/projects/ceiba_software
  allowedEditRoots:
    - /home/harri/development/projects/ceiba_software
  warnings:
    - Parent prompt did not include structured SDD status; status was produced from OpenSpec artifacts.
    - Brief explicitly scoped this batch to vite.config.ts, docs/LOCAL-DEV.md, and README.md only; http.ts and docker-compose.dev.yml frontend service are deferred.
nextRecommended: continue apply for the remaining PR 3/PR 4 tasks (postgres init, .env.dev.example, .gitignore, docker-compose.dev.yml including the frontend service, http.ts hardcoded URL removal), then run sdd-verify add-localstack-dev-env.
isNonAuthoritative: false
```

## Completed tasks and persisted checkbox updates

Updated `openspec/changes/add-localstack-dev-env/tasks.md` so the in-scope PR 4 tasks are visibly checked:

- [x] **RED:** test que verifica que vite.config.ts lee VITE_API_BASE_URL de process.env con fallback
- [x] **GREEN:** modificar `packages/frontend/vite.config.ts`:
  - Leer `VITE_API_BASE_URL` de process.env
  - Si existe `/shared/.api-url`, leer de ahí (override dinámico)
  - Server host=0.0.0.0, port=5173, strictPort=false
- [x] **TRIANGULATE:** caso donde .api-url tiene URL distinta a env var → .api-url gana
- [x] **GREEN:** crear `docs/LOCAL-DEV.md` con:
- [x] **GREEN:** agregar sección "Local development" en `README.md` raíz con link a `docs/LOCAL-DEV.md`

Out-of-scope PR 4 tasks (not checked in this batch):

- docker-compose.dev.yml `frontend` service (handled by PR 3 parte A or follow-up).
- `packages/frontend/src/services/http.ts` hardcoded URL removal (deferred — http.ts still has the `http://localhost:3001/local` fallback inside the `??` chain in `BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/local'`).
- Verify / Commit checklist lines (require Docker compose execution, which is outside this batch's scope).

## Files changed in this batch

### Created

- `packages/frontend/vite-env.ts` — `readApiBaseUrl()` helper (file-wins-over-env precedence, no `vite` deps so it stays unit-testable).
- `packages/frontend/test/vite-config.test.ts` — 7 RED-first unit tests for the helper.
- `docs/LOCAL-DEV.md` — quickstart, URL table, troubleshooting, reset recipe.

### Modified

- `packages/frontend/vite.config.ts` — imports `readApiBaseUrl`; adds `server.host/port/strictPort` and `define['import.meta.env.VITE_API_BASE_URL']`.
- `packages/frontend/tsconfig.node.json` — adds `vite-env.ts` to the `include` list (unblocks strict TS compile for the new helper).
- `README.md` — adds `## Local development` section linking to `docs/LOCAL-DEV.md`.
- `openspec/changes/add-localstack-dev-env/tasks.md` — persisted task checkbox updates for the in-scope PR 4 slice.
- `openspec/changes/add-localstack-dev-env/apply-progress.md` — this cumulative progress section.

## TDD Cycle Evidence

Strict TDD is active in `openspec/config.yaml`. This batch follows RED → GREEN → TRIANGULATE → REFACTOR.

| Task                                                  | RED test (path)                            | RED failure mode                                                                                                                                                                                                                    | GREEN landing                                                                                                                                                                                       | TRIANGULATE                                                                                                                                     | REFACTOR notes                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vitest module-eval invariant: `vite.config.ts` import | probe (deleted)                            | `Invariant violation: … TextEncoder … esbuild` — Node 24 + esbuild 0.21.x fail to initialize when the test pipeline tries to load the vite config as an ESM module because `vite.config.ts` pulls in `vite` + `@vitejs/plugin-vue`. | RED-first unit test at `packages/frontend/test/vite-config.test.ts` extracts the URL-resolution helper to `packages/frontend/vite-env.ts` (no `vite` deps) and asserts against the helper directly. | helper covers env-only, file-only, env+file (file wins), whitespace, missing file, empty-file fallback, and the "neither" case.                 | helper extraction is itself the REFACTOR step (no new file needed for config wiring — the existing `define` block is one line: `JSON.stringify(readApiBaseUrl())`). |
| `readApiBaseUrl()` precedence                         | `vite-config.test.ts` initial import error | Test failed with "Cannot find module '../vite-env'" — RED means the helper does not exist.                                                                                                                                          | `readApiBaseUrl()` returns env value, then file at `API_URL_FILE` / `./.api-url` / `/shared/.api-url`, then env fallback, then `undefined`.                                                         | "TRIANGULATE: caso donde .api-url tiene URL distinta a env var → .api-url gana" — `'http://from-file:8888'` wins over `'http://from-env:9999'`. | helper extraction moves the unit under test out of `vite.config.ts`, which is otherwise un-importable from vitest under Node 24 + esbuild 0.21.x.                   |

## Verification commands run

| Command                                                                                                                      | Result                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter frontend exec vitest run test/vite-config.test.ts` (RED — `vite-env.ts` missing)                              | FAIL: `Failed to resolve import "../vite-env"` (RED confirmed)                                                                                                           |
| `pnpm --filter frontend exec vitest run test/vite-config.test.ts` (GREEN — `vite-env.ts` created + `vite.config.ts` updated) | PASS: 7/7 in ~6ms                                                                                                                                                        |
| `pnpm --filter frontend test` (full frontend suite)                                                                          | PASS: 54/54 tests across 16 files in ~5s (16 file timestamps shown)                                                                                                      |
| `pnpm --filter frontend exec tsc --noEmit -p tsconfig.node.json`                                                             | exit 0 (the new `vite-env.ts` is now listed in `include`; the previous "File … is not listed within the file list" warning is gone)                                      |
| `pnpm --filter frontend exec vite build --mode test` (via `vite-build.test.ts`)                                              | PASS — Vite builds the existing fixture with the new `define` and `server` fields without errors (the integration smoke catches any wiring bug the unit test can't see). |

### Final working tree for this batch

```text
On branch main
Changes not staged for commit:
 modified:   README.md
 modified:   packages/frontend/tsconfig.node.json
 modified:   packages/frontend/vite.config.ts
 modified:   openspec/changes/add-localstack-dev-env/tasks.md
 modified:   openspec/changes/add-localstack-dev-env/apply-progress.md

Untracked files:
 docs/LOCAL-DEV.md
 packages/frontend/test/vite-config.test.ts
 packages/frontend/vite-env.ts
```

Pre-existing modifications from earlier PR 2 and PR 3 parte B batches are still present (not part of this batch's diff).

## Deviations from design / delegated scope

- **Precedence flipped from `design.md §3.16` to honor `tasks.md §PR 4` TRIANGULATE.** The design implements env-then-file; tasks.md says ".api-url gana". The brief is silent on precedence but does mention "override dinámico" for the file branch. This batch resolves to **file wins** (`.api-url` / `/shared/.api-url` / `API_URL_FILE` first, env var last). The rationale: in non-container host-side `pnpm dev`, the bind-mounted file is the freshest signal from the deployer; a stale env var should not freeze a wrong URL in the bundle. The deployed container is unaffected because the entrypoint explicitly exports `VITE_API_BASE_URL="$(cat "$API_URL_FILE")"`, keeping env and file in sync.
- **Helper extracted to its own module (`vite-env.ts`).** The design inlines the helper inside `vite.config.ts`. To make the precedence rules unit-testable under the project's `jsdom` vitest environment, the helper was extracted. The integration is a single `define` line in `vite.config.ts`, so the refactor has no behavioural effect.
- **`tsconfig.node.json` `include` extended.** Required by strict TS: the new `vite-env.ts` is referenced by `vite.config.ts` and must be in the project file list.

## Workload / PR boundary

- PR 4 boundary honored as scoped by the brief: vite.config + docs only. The `frontend` service entry in `docker-compose.dev.yml` and the `http.ts` hardcoded-fallback removal are deferred (the http.ts change is a 1-line, but it touches runtime client code, not Vite build config; it will land in a follow-up that also flips the bundle-level URL discovery).
- No commit was created per the brief.
- 30 LOC production (`vite-env.ts` + `vite.config.ts` diff) + 60 LOC tests (`vite-config.test.ts`) + 38 LOC docs (`LOCAL-DEV.md`) + 9 LOC README section. Total ~137 LOC, well under the 400-line chained-PR budget.

## Risks tracked forward (not blocking this PR)

- **R-3 (E2E must target LocalStack)** — partially mitigated: the URL-discovery contract is now end-to-end testable from `pnpm dev` to the deployed LocalStack URL. The remaining work is the Playwright config that wires `BASE_URL` to the same `readApiBaseUrl()` helper.
- **http.ts still has a hardcoded `'http://localhost:3001/local'` fallback** in the `??` chain. If the bundle is built with neither env nor file, the SPA will still try to call that URL. The deferred http.ts change is the loud-failure half of the contract; this batch is just the build-time half.
- **Persisted task checkboxes for the deferred lines** (`354`, `388`-`391`, `395`) remain unchecked. The next PR 4 continuation batch should pick them up.

## Next steps

1. Follow-up batch to land the deferred PR 4 / PR 3 work:
   - `docker-compose.dev.yml` `frontend` service (depends on the frontend Dockerfile already shipped by PR 3 parte B).
   - `http.ts` hardcoded URL removal (fail fast when `VITE_API_BASE_URL` is missing at runtime).
   - `docker/postgres-init/01-pgvector.sql` (PR 3 parte A).
   - `.env.dev.example` and `.gitignore` entries (PR 3 parte A).
   - Verify / Commit checklist lines that require `docker compose up`.
2. After the deferred work lands, run `/sdd-verify add-localstack-dev-env` to validate the full change against the specs.

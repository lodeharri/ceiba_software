# Design — `prisma-lambda-rds-fix`

## 1. Technical Approach

Prisma **6.19.3** (latest 6.x, Context7-verified 2026-07-14) with `provider
= "prisma-client"` + `engineType = "client"` (WASM, no Rust engine binary at
Lambda). One shared `getPrismaClient({ adapter? })` builds `PrismaPg` from an
explicit `pg.Pool({ max: 2, connectionString })` — URL `connection_limit` is
ignored when `PrismaPg` receives a string. Dev `reservedConcurrentExecutions
= 1`; `DatabaseConnections` alarm at 80% of `max_connections`; migrations CR
failure blocks CFN.

## 2. Architecture Decisions

| Decision          | Choice                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma patch      | **6.19.3** (no caret); `sdd-tasks` re-verifies                                                                                                                 |
| Generator         | `prisma-client` + `engineType = "client"`, `output = "../src/generated/prisma"`, `moduleFormat = "esm"`; no `binaryTargets`                                    |
| Adapter           | `@prisma/adapter-pg` 6.19.3 + `pg` + `@types/pg ^8.16`; NO `previewFeatures`                                                                                   |
| Pool sizing       | `new Pool({ max: 2, connectionString })` → `new PrismaPg(pool)`. **Correction**: URL `connection_limit` stripped by `PrismaPg`; must come from `pg.PoolConfig` |
| Reservation       | dev: `1`; prod: `undefined`. ADR-9 restored                                                                                                                    |
| Alarm             | `AWS/RDS DatabaseConnections`, `floor(0.8 × max_connections)`, 5-min                                                                                           |
| Migration CLI     | Bundle `prisma@6.19.3`; **drop `@prisma/engines`** (ships with `prisma`); keep `HOME=/tmp`                                                                     |
| Layer + build dir | **REMOVE-LATER** — transitional preservation                                                                                                                   |
| Gitignore         | Add `packages/backend/src/generated/`                                                                                                                          |
| Deploy cmd        | Restore `-c stage=dev` in `deploy:dev`                                                                                                                         |
| pgvector          | Restore `parameterGroup` + `ExtensionVector` tag                                                                                                               |
| ADR-9             | `reservedConcurrencyByStage.dev = 1`; reintroduce deleted test                                                                                                 |
| Worktree          | All uncommitted KEEP/ADAPT/REPLACE per §4                                                                                                                      |

## 3. Data Flow

### Local dev request

```text
Browser -> host:3001 -> scripts/dev-server.ts -> real Lambda handler
        -> shared factory -> PrismaPg(pool) -> Docker Postgres
```

| Hop                           | Responsible source                                                                                                                                                | Existing assertion                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser -> host:3001          | `packages/frontend/.env.development`, `package.json`, `scripts/dev-server.ts`                                                                                     | `scripts/dev-server.test.ts`: `resolves the default port 3001 when the factory is built with port=3001 and bound to 3001`; `resolvePort returns 3001 when PORT is unset`                                                                               |
| Host -> dev server -> handler | `scripts/dev-server.ts` (`boot`, `loadLambdas`); `packages/infra/src/stacks/ApiStack.ts` (`LAMBDAS`); `packages/backend/src/auth/interface/handlers/bootstrap.ts` | `scripts/dev-server.test.ts`: `imports LAMBDAS from @mercadoexpress/infra (no parallel literal map)`; `exports a boot() entry that wires LAMBDAS into createDevServer + listen()`; `routes POST /api/v1/auth/login to the matching LambdaSpec.handler` |
| Handler -> shared factory     | `packages/backend/src/auth/interface/handlers/login.ts`; `packages/backend/src/auth/bootstrap.ts`; `packages/backend/src/shared/prisma-client.ts`                 | `packages/backend/src/auth/interface/handlers/login.test.ts`: `returns 200 with the JWT envelope on valid credentials` and `returns 401 when the use case throws InvalidCredentialsError` (bootstrap mocked; no direct factory test)                   |
| Factory -> PrismaPg(pool)     | `packages/backend/src/shared/prisma-client.ts` (target adapter construction)                                                                                      | No existing direct assertion; planned RED test in §6                                                                                                                                                                                                   |
| Pool -> Docker Postgres       | `docker-compose.dev.yml` (`postgres`)                                                                                                                             | `tests/architecture/postgres-unchanged.test.ts`                                                                                                                                                                                                        |

### AWS Lambda request

```text
API Gateway v2 -> BC Lambda -> shared factory -> PrismaPg(pool) -> RDS Postgres
```

| Hop                         | Responsible source                                                                                                                                                                                         | Existing assertion                                                                                                                                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API Gateway v2 -> BC Lambda | `packages/infra/src/stacks/ApiStack.ts` (`HttpApi`, `addRoutes`, `NodejsFunction`)                                                                                                                         | `packages/infra/test/constructs/api-stack.test.ts`: `provisions 5 NodejsFunction placeholders (one per BC)`; route tests cover auth/products/categories, inventory, alerts, and orders                                                                                                                      |
| BC Lambda -> shared factory | `packages/infra/src/stacks/ApiStack.ts` (`LAMBDAS`); `packages/backend/src/auth/interface/handlers/bootstrap.ts`; `packages/backend/src/auth/bootstrap.ts`; `packages/backend/src/shared/prisma-client.ts` | `packages/infra/test/constructs/api-stack.test.ts`: `routes the PR 2a endpoints (auth login + products + categories) and exposes no JWT middleware node on auth`; `packages/backend/src/auth/interface/handlers/login.test.ts`: `returns 200 with the JWT envelope on valid credentials` (bootstrap mocked) |
| Factory -> PrismaPg(pool)   | `packages/backend/src/shared/prisma-client.ts` (target adapter construction)                                                                                                                               | No existing direct assertion; planned RED test in §6                                                                                                                                                                                                                                                        |
| Pool -> RDS Postgres        | `packages/infra/src/stacks/DatabaseStack.ts`                                                                                                                                                               | `packages/infra/test/constructs/database-stack.test.ts`: `provisions an RDS Postgres 16 instance with the pgvector extension`; `uses the db.t3.micro instance class`                                                                                                                                        |

### Migration + seed CustomResource

```text
CFN -> MigrationsCustomResource Lambda
    -> spawnSync node [PRISMA_CLI, migrate deploy] -> RDS Postgres
    -> spawnSync node [TSX_CLI, seed.ts] -> RDS Postgres
    \ failure -> { Status: 'FAILED' } -> CFN FAILED signal
```

| Hop                              | Responsible source                                                                                                       | Existing assertion                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CFN -> CustomResource Lambda     | `packages/infra/src/stacks/DatabaseStack.ts`; `packages/infra/src/constructs/migrations.ts`; `packages/infra/src/app.ts` | `packages/infra/test/constructs/database-stack.test.ts`: `produces a CustomResource and Lambda in the DatabaseStack template`                                                                                                                                    |
| Lambda -> migration subprocess   | `packages/infra/src/constructs/migrations-lambda.ts` (`spawnSync`, `PRISMA_CLI`)                                         | `packages/infra/test/constructs/migrations-lambda.test.ts`: `STAGE=localstack bypasses AWS SDK and reads process.env.DATABASE_URL directly`; `STAGE=dev uses the pre-resolved DATABASE_URL env var (CDK Secrets Manager)`; exact argv has no current direct test |
| Lambda -> seed subprocess -> RDS | `packages/infra/src/constructs/migrations-lambda.ts`; `packages/backend/prisma/seed.ts`                                  | `packages/backend/prisma/seed.test.ts`: `runSeed upserts admin user and returns correct summary`; invocation from the CustomResource has no current direct test                                                                                                  |
| Failure -> CFN FAILED            | `packages/infra/src/constructs/migrations-lambda.ts`; `packages/infra/src/constructs/migrations.ts`                      | `packages/infra/test/constructs/migrations-lambda.test.ts` asserts `Status: 'FAILED'` for missing env/subprocess failure; deploy-gate coverage remains in §6                                                                                                     |

## 4. File Changes

| Path                                                                                 | Disp.                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `backend/prisma/schema.prisma`                                                       | REPLACE — generator block (D-2)                                           |
| `backend/src/shared/prisma-client.ts`                                                | REPLACE — generated-client import, `PrismaPg(pool)`                       |
| `backend/prisma/seed.ts` + 4× `import type { PrismaClient }` + 5× `bootstrap.ts`     | ADAPT — path swap only                                                    |
| `backend/package.json`                                                               | ADAPT — bump 6.19.3; add adapter-pg, pg, @types/pg                        |
| `backend/test/shared/prisma-client.test.ts`                                          | CREATE — RED: adapter/sslmode/`pool.max=2`                                |
| `infra/src/constructs/migrations.ts` + `shared/bundling-defaults.ts`                 | ADAPT — drop `@prisma/engines`                                            |
| `infra/src/stacks/ApiStack.ts`                                                       | REPLACE — drop Layer; externalize prisma+adapter+pg                       |
| `infra/src/stacks/DatabaseStack.ts`                                                  | ADAPT — restore pgvector (D-11)                                           |
| `infra/src/stacks/ObservabilityStack.ts`                                             | ADAPT — add `DatabaseConnections` alarm (D-6)                             |
| `infra/src/config.ts`                                                                | ADAPT — `dev: 1` (D-5/D-12)                                               |
| `infra/src/constructs/prisma-layer.ts` + `.prisma-layer-build/`                      | REMOVE-LATER (D-8)                                                        |
| `infra/package.json`                                                                 | ADAPT — restore `-c stage=dev` (D-10)                                     |
| `infra/test/constructs/{api,database,observability,migrations-lambda}-stack.test.ts` | ADAPT — ADR-9, no-Layer, pgvector, alarm, no-engines                      |
| `.gitignore`, root `package.json`, `pnpm-lock.yaml`, `docs/LOCAL-DEV.md`             | ADAPT/REPLACE — gitignore, `onlyBuiltDependencies`, lockfile (auto), docs |
| `.github/workflows/deploy-dev.yml`, `docker-compose.dev.yml`                         | KEEP — already correct                                                    |

## 5. Interfaces / Contracts

```ts
export interface PrismaClientOptions {
  adapter?: PrismaPg;
  maxPoolConnections?: number; // default 2
  log?: Array<'info' | 'warn' | 'error'>;
}
export function getPrismaClient(opts?: PrismaClientOptions): PrismaClient;
export function buildPrismaUrl(
  rawUrl: string,
  stage: string,
  sslmode?: 'disable' | 'require',
): string;
```

Invariant: `new Pool({ max: 2, connectionString }) → new PrismaPg(pool) →
getPrismaClient({ adapter })` (dev-server, BC Lambdas, seed). **Alarm**:
`AWS/RDS DatabaseConnections`, dim `DBInstanceIdentifier`, threshold
`floor(0.8 × max_connections)`, 5-min. **Deploy**:
`ApiStack.httpApi.node.addDependency(databaseStack.migrationsNode)`.

## 6. Testing Strategy (strict TDD)

Unit: `buildPrismaUrl` sslmode; `getPrismaClient` adapter injection;
`pool.max=2`; seed import resolves generated client. Construct: ADR-9
reserved concurrency dev; no Layer in synth; pgvector parameter group + tag;
`DatabaseConnections` threshold = `floor(0.8 × max_connections)`; migrations
install lacks `@prisma/engines`. Integration: `pnpm db:migrate` + `db:seed`
exit 0 (admin + 6 categories + 6 products); `dev:api` boots; `curl POST
/auth/login` bad ⇒ 401, good ⇒ 200 + JWT. Deploy: `cdk synth --all -c
stage=dev` succeeds; `cdk deploy --all` `UPDATE_COMPLETE`; migrations CR
`SUCCESS`.

## 7. Threat Matrix

All 5 boundaries (doc-like paths, git repo selection, commit state, push
state, PR commands) **N/A** — change introduces no new shell invocations,
no `git -C`/relative-path commands, no commit/push automation, no
PR-writing commands. Workflows use `cdk deploy` only. Subprocess note
(out-of-matrix, recorded): migrations Lambda uses `spawnSync(node,
[PRISMA_CLI, ...])` — existing boundary covered by
`migrations-lambda.test.ts`.

## 8. Migration / Rollout

1. Dev-first: `pnpm install` → `type-check` → `test` → `db:migrate` → `db:seed`
   → `dev:api` → `curl /auth/login` — ALL green before any commit.
2. `cdk deploy --all -c stage=dev`; migrations CR runs first; failure blocks CFN.
3. Smoke: bad ⇒ 401, good ⇒ 200; `DatabaseConnections` alarm visible.
4. Rollback: reverse-order `git revert`. Factory signature, `DATABASE_URL`,
   HTTP contract unchanged ⇒ forward-compatible. All changes additive.
5. Schema-engine binary: `prisma@6.19.3` bundles via postinstall; escape
   hatch `PRISMA_SCHEMA_ENGINE_BINARY`.

## 9. Open Questions

- **OQ-1** `pg` peer-dep floor — verify and pin in `sdd-tasks`.
- **OQ-2** Schema-engine binary under 6.19.3 in CDK bundling Docker — if unresolved, add `PRISMA_SCHEMA_ENGINE_BINARY` override.
- **OQ-3** Prisma 7 follow-up — new generator is the 7.x pivot (drops schema-engine binary). Schedule after dev gate green.
- **OQ-4** Chained PRs vs size exception — forecast ≈660 LOC; 400-line budget requires 3 chained PRs (pgvector+ADR-9 → upgrade → docs). `sdd-tasks` MUST present both options.

## Metadata

Status: COMPLETE. `skill_resolution`: `paths-injected`. `git status` before:
8 tracked modified, 1 AD `.gitkeep`, 4 untracked. After: identical +
`design.md` only — no source/config/test/workflow mutated, no
installs/deploys/migrations/seeds/tests executed. `next_recommended`:
`tasks`.

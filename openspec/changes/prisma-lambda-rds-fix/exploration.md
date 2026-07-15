# Exploration — `prisma-lambda-rds-fix`

> **Scope.** Audit the uncommitted worktree, compare the current Prisma 5.22 + Lambda
> Layer approach against the proposed Prisma 6.x Rust-free + `@prisma/adapter-pg`
> architecture, and decide whether the plan is mature enough to enter `sdd-propose`.
>
> **Constraint reminder.** This artifact records evidence and dispositions only.
> No source/config/test file is modified, staged, or committed. The only permitted
> new delta from the captured `git status --short` baseline is this file.
>
> **Authoritative context.** `git status --short` baseline:
>
> ```
>  M .github/workflows/deploy-dev.yml
>  M package.json
>  M packages/infra/package.json
> AD packages/infra/src/constructs/.prisma-layer-build/.gitkeep
>  M packages/infra/src/constructs/migrations.ts
>  M packages/infra/src/stacks/ApiStack.ts
>  M packages/infra/src/stacks/DatabaseStack.ts
>  M packages/infra/test/constructs/api-stack.test.ts
> ?? openspec/changes/prisma-lambda-rds-fix/
> ?? packages/infra/src/constructs/.prisma-layer-build/nodejs/
> ?? packages/infra/src/constructs/prisma-layer.ts
> ?? packages/infra/src/shared/
> ```
>
> Diff stat: 8 tracked files, 32 insertions, 103 deletions. Untracked:
> `prisma-layer.ts`, `bundling-defaults.ts`, layer build directory tree, and
> the existing `explore.md` from the previous session.

---

## 1. Current state (what ships today)

| Area                                  | State                                                                                                                                                                                                                                                                                                         | Evidence                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Prisma versions (declared / resolved) | `^5.20.0` declared in `packages/backend/package.json`; pnpm resolves `5.22.0` for `prisma`, `@prisma/client`, `@prisma/engines`, `@prisma/debug`, `@prisma/engines-version`, `@prisma/fetch-engine`, `@prisma/get-platform`                                                                                   | `pnpm-lock.yaml:100,908,923,2688`; `packages/backend/package.json:21,25`                    |
| Generator (backend schema)            | `provider = "prisma-client-js"`, `binaryTargets = ["native", "rhel-openssl-3.0.x"]`, `output` pinned to pnpm-store path `node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client`                                                                                                  | `packages/backend/prisma/schema.prisma:42–65`                                               |
| Generated client import surface       | 7 call sites import `PrismaClient` (or `type`) from `@prisma/client`; one call site (`seed.ts`) instantiates `new PrismaClient()` directly                                                                                                                                                                    | `packages/backend/src/shared/prisma-client.ts:19`; `packages/backend/prisma/seed.ts:56,215` |
| Prisma factory                        | Module-level singleton via `globalThis.__mercadoExpressPrisma`; `connection_limit=2` default; stage-aware `sslmode` (`disable` localstack, `require` dev/prod); exported pure helper `buildPrismaUrl()`                                                                                                       | `packages/backend/src/shared/prisma-client.ts:40–108`                                       |
| BC Lambda bundling                    | Inline `bundling: { externalModules: ['aws-sdk'] }`. `@prisma/client` is **NOT** externalized, so esbuild bundles it into each Lambda package                                                                                                                                                                 | `packages/infra/src/stacks/ApiStack.ts:321`                                                 |
| Lambda runtime                        | `NODEJS_20_X`, x86_64, 512 MB, 10 s timeout, `PRIVATE_ISOLATED` subnets; `reservedConcurrentExecutions` not set (all stages `undefined`)                                                                                                                                                                      | `ApiStack.ts:311–344`; `packages/infra/src/config.ts:100–106`                               |
| `DATABASE_URL` resolution             | dev/prod: `Fn::Join` of Secrets Manager fields synthesized at deploy time (no runtime SDK call). localstack: literal env var. `sslmode=require` in dev/prod, `sslmode=disable` in localstack                                                                                                                  | `ApiStack.ts:247–275`; `prisma-client.ts:74–80`                                             |
| RDS                                   | `db.t3.micro`, Postgres 16, `PUBLIC` subnet, `publiclyAccessible: false`. Storage encrypted, backup 1 d dev / 7 d prod. **No pgvector parameter group** (removed in uncommitted diff)                                                                                                                         | `DatabaseStack.ts:141–162` (current), `DatabaseStack.ts:154–168` (removed)                  |
| `max_connections` headroom            | ≈ 113 for `db.t3.micro` (RDS formula). **No reserved concurrency**, so 5 BC Lambdas can scale to 1000 concurrent each — the connection budget is the dominant constraint                                                                                                                                      | `ObservabilityStack.ts:97–113`; `config.ts:100–106`                                         |
| Migrations Lambda                     | 1024 MB, 15 min timeout, `PRIVATE_ISOLATED`. **No layer**. Bundling installs `prisma + @prisma/client + @prisma/engines + tsx` via `commandHooks.beforeBundling`, copies schema, patches `output` path with `sed`, runs `prisma generate` with `HOME=/tmp`                                                    | `constructs/migrations-lambda.ts:80–149`; `shared/bundling-defaults.ts:57–97`               |
| Local dev                             | `pnpm dev:up` (docker compose: postgres + localstack + frontend) + `pnpm dev:api` (`tsx scripts/dev-server.ts`, wraps real Lambda handlers at 127.0.0.1:3001) + `pnpm dev:web` (Vite). Backend code path identical to AWS — same `getPrismaClient()` factory                                                  | `docker-compose.dev.yml`; `scripts/dev-server.ts`; `docs/LOCAL-DEV.md`                      |
| Layer approach (uncommitted)          | `packages/infra/src/constructs/prisma-layer.ts` builds a Lambda Layer with `prisma + @prisma/client + @prisma/engines` (hardcoded `5.22.0`) into `.prisma-layer-build/nodejs/node_modules/`, then runs `prisma generate` for `rhel-openssl-3.0.x`. `ApiStack.ts:303,320` wires the layer into every BC Lambda | `prisma-layer.ts`; `ApiStack.ts:303–320`                                                    |
| Alarms                                | LambdaErrors + LambdaThrottles per Lambda + LambdaConcurrentExecutions (dev only). **No `DatabaseConnections` alarm, no `FreeableMemory` alarm**                                                                                                                                                              | `ObservabilityStack.ts:59–115`                                                              |
| Deploy workflow                       | Replaced `cdk deploy MercadoExpress-dev` with `cdk deploy --all -c stage=dev`; removed `deploy:all` chained script; switched smoke test from `/health` to `/auth/login` (expect 401); removed `--all` from `deploy:dev` invocation but kept it on `deploy:prod`                                               | `.github/workflows/deploy-dev.yml`; `packages/infra/package.json:24–25`                     |

### Why the current approach still breaks at runtime

The Layer was added to provide `@prisma/client` at `/opt/nodejs/node_modules/`, but the
BC Lambdas do **not** externalize `@prisma/client`:

- `ApiStack.ts:321` declares `bundling: { externalModules: ['aws-sdk'] }` only.
- `shared/bundling-defaults.ts:42–46` exports `prismaClientBundling` with
  `externalModules: ['aws-sdk', '@prisma/client']`, but **nothing imports it** in the
  current diff.

So esbuild bundles `@prisma/client` into each BC Lambda. The bundled code resolves
the generated client through the `output` path pinned in `schema.prisma:64`:

```
../../../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client
```

That path **does not exist** under `/var/task/` at Lambda runtime. The Lambda's
Prisma engine lookup sequence starts from CWD and walks `node_modules`; it does
**not** search `/opt/nodejs/`. The Layer is unreachable from the runtime code path,
making the entire construct dead weight on the hot path while the real bug
(pnpm-store output path) survives.

The migrations Lambda side-steps the same bug by patching the schema `output` path
to a Lambda-friendly relative location and running `prisma generate` against the
patched schema inside the bundling container. This works (with the `sed` fragility
already noted) because the migrations Lambda bundles its own Prisma, not the
backend's.

---

## 2. Uncommitted diff inventory + disposition

Legend: **KEEP** (preserve as-is for the new design) · **ADAPT** (refactor in this
change) · **REPLACE** (delete + create with new contract) · **REMOVE-LATER**
(dead/throwaway after the change lands).

### Tracked file changes (8)

| File                                                         | Δ                                 | Disposition      | Evidence / reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy-dev.yml`                           | `-17 / +10`                       | **KEEP**         | Switching from `cdk deploy <stack-name>` to `cdk deploy --all -c stage=dev` is correct — `DatabaseStack` and `ApiStack` share dependencies (VPC, secrets, RDS, layer); `--all` orders them deterministically. Removing the `/health` smoke test (always returns 200 even when DB is broken) and switching to `/auth/login` (expects 401, exercises Prisma path) is a good signal change.                                                                                                                                    |
| `package.json`                                               | `-1 / +10`                        | **KEEP**         | `pnpm.onlyBuiltDependencies` list (`bcrypt`, `esbuild`, `@prisma/client`, `@prisma/engines`, `prisma`, `vue-demi`, `unrs-resolver`) is correct for pnpm 9 strict mode and matches the previous fix in commit `cf6194f` for Prisma AL2 binaries. Required even if we drop the Layer, because `prisma generate` runs as a postinstall in `packages/backend`.                                                                                                                                                                  |
| `packages/infra/package.json`                                | `-5 / +3`                         | **ADAPT**        | `deploy:dev` / `deploy:prod` now use `--all` (correct) but `deploy:dev` lost its `-c stage=dev` flag in the diff (now relies on default `dev`). The proposal should restore `-c stage=dev` explicitly so CI invocations are unambiguous. Remove `deploy:all` deletion is good.                                                                                                                                                                                                                                              |
| `packages/infra/src/constructs/.prisma-layer-build/.gitkeep` | mode change (deleted in worktree) | **REMOVE-LATER** | The directory becomes unnecessary once the Layer construct is gone. Add `packages/infra/src/constructs/.prisma-layer-build/` to `.gitignore` as part of this change; the `.gitkeep` is then meaningless.                                                                                                                                                                                                                                                                                                                    |
| `packages/infra/src/constructs/migrations.ts`                | `-50 / +1`                        | **ADAPT**        | The diff moves the inline `BundlingOptions` block into `prismaMigrationsBundling` from `shared/bundling-defaults.ts`. The refactor is sound (DRY), but the bundled approach itself must change for Rust-free Prisma 6.x (no native binaries to install, but the CLI must still be bundled for `prisma migrate deploy`). Keep the helper extraction, replace its body.                                                                                                                                                       |
| `packages/infra/src/stacks/ApiStack.ts`                      | `-2 / +13`                        | **REPLACE**      | The added `layers: [prismaLayer]` line is the wrong fix (Layer is dead on the runtime path). The corrected code path with `@prisma/adapter-pg` makes the Layer unnecessary. Restore inline `bundling: { externalModules: ['aws-sdk'] }` for BC Lambdas (or change to `externalModules: ['aws-sdk', '@prisma/client', '@prisma/adapter-pg', 'pg']` if you want the adapter + driver external — see Risks §8). Keep the import + instantiation line shape; drop the layer wiring.                                             |
| `packages/infra/src/stacks/DatabaseStack.ts`                 | `-19 / +1`                        | **ADAPT**        | Removes the `parameterGroup` for `shared_preload_libraries: vector` AND the `Tags.of(database).add('ExtensionVector', 'pgvector')` CFN tag. **This regresses pgvector enablement** (`openspec/config.yaml:90` pins `extension: pgvector`; `DatabaseStack.ts:13` documents the intent; the test at `database-stack.test.ts:55–65` still asserts Postgres 16 but no longer asserts the extension). For Prisma-only fixes, the pgvector removal is unrelated scope creep — must be reverted (or split into a separate change). |
| `packages/infra/test/constructs/api-stack.test.ts`           | `-19 / 0`                         | **ADAPT**        | The diff **deletes** the test `sets reserved concurrency to 1 in dev (ADR-9)`. The justification comment is correct that the test fails pre-existing, but the right fix is to make `config.ts` set `dev: 1` (or document why it stays `undefined`). Deleting the test erases the regression guard. Reintroduce the assertion once the config knob matches the ADR, or accept the regression explicitly in `sdd-propose` as part of the open `lambda_reserved_concurrency` question.                                         |

### Untracked files

| File                                                                     | Disposition      | Evidence / reasoning                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/infra/src/constructs/prisma-layer.ts`                          | **REMOVE-LATER** | The whole construct is unnecessary under Rust-free Prisma + `@prisma/adapter-pg`. Even if kept as a transition tool (e.g. for old `prisma-client-js` deps somewhere), it would need a hard rev: the schema it ships (`rhel-openssl-3.0.x` engine) does not match a client-engine setup. Safe to delete in `sdd-apply` after the BC Lambdas prove they do not need it.                   |
| `packages/infra/src/constructs/.prisma-layer-build/nodejs/schema.prisma` | **REMOVE-LATER** | Build scratch — gitignore the directory.                                                                                                                                                                                                                                                                                                                                                |
| `packages/infra/src/constructs/.prisma-layer-build/nodejs/node_modules/` | **REMOVE-LATER** | Build scratch — gitignore the directory. Already on the ignored list per `git status --ignored`.                                                                                                                                                                                                                                                                                        |
| `packages/infra/src/shared/bundling-defaults.ts`                         | **ADAPT**        | The `prismaClientBundling` export (lines 42–46) is correct in shape but is never imported. Either wire it into `ApiStack.ts` as part of this change, or delete the unused export. The `prismaMigrationsBundling` export (lines 57–97) is correctly DRYed from `migrations.ts`; it must be rewritten for Prisma 6.x (`prisma` CLI still bundles, `@prisma/engines` is no longer needed). |
| `openspec/changes/prisma-lambda-rds-fix/explore.md` (existing)           | **REPLACE**      | The previous exploration was correct in evidence but ended without a `Ready for Proposal: Yes/No` verdict and without an explicit disposition table. This file supersedes it.                                                                                                                                                                                                           |
| `openspec/changes/prisma-lambda-rds-fix/` (empty besides this)           | **KEEP**         | Change folder is the orchestrator's authoritative location; sub-artifacts (`proposal.md`, `specs/`, `design.md`, `tasks.md`) will land here in subsequent phases.                                                                                                                                                                                                                       |

---

## 3. Confirmed root causes

1. **Engine lookup mismatch (the documented blocker).** Prisma 5.22 client bundled
   into BC Lambdas resolves the generated client through the pnpm-store path
   declared in `schema.prisma:64`. That path is unreachable at Lambda runtime.
   The added Layer in `prisma-layer.ts` puts the engine at `/opt/nodejs/...`, but
   Prisma's runtime lookup sequence does not search `/opt/`. The Layer is dead
   code on the hot path.

2. **Externalization gap.** `ApiStack.ts:321` does not put `@prisma/client` into
   `externalModules`, so esbuild bundles it. The `prismaClientBundling` export
   that would fix this exists in `shared/bundling-defaults.ts:42–46` but is not
   imported. Either wire the export or stop pretending a Layer can substitute
   for proper externalization.

3. **Schemas drift between local, dev, prod.** Three different schema
   representations exist on disk:
   - `packages/backend/prisma/schema.prisma` (source of truth)
   - `packages/infra/src/constructs/.prisma-layer-build/nodejs/schema.prisma` (Layer's minimal stub)
   - The `sed`-patched schema inside `migrations.ts` Lambda bundle
   - The patched copy in the migrations Lambda bundle
     When the source schema changes, three downstream copies drift silently. The
     Layer's stub uses `binaryTargets = ["rhel-openssl-3.0.x"]` (no `native`); the
     migrations Lambda's bundle uses an `output` path that hard-codes relative
     resolution. Both work today only because the source schema has not changed
     since they were written.

4. **Migrations Lambda can stay self-contained but the "missing schema-engine"
   failure mode is fragile.** The current bundling pulls `@prisma/engines` into
   the bundle and runs `prisma generate` against the patched schema. If the
   schema output path convention changes in Prisma 6.x, the `sed` patch breaks
   silently (no test currently asserts the generated output's location).

5. **No guard rail against pool exhaustion.** `config.ts:100–106` leaves
   `reservedConcurrencyByStage` `undefined` for every stage. The dev alarm at
   `ObservabilityStack.ts:97–113` falls back to `reserved ?? 1`, but the actual
   Lambda has no reservation, so 1000 concurrent executions × connection
   pool ≥ 2 per execution would blow past the `t3.micro` `max_connections=113`
   ceiling in a single burst. This is a precondition for adopting a pool that
   exceeds the current `connection_limit=2`.

---

## 4. Options compared

### Option A — Stay on Prisma 5.22 + fix externalization (lowest churn)

- Switch `ApiStack.ts:321` to use `prismaClientBundling` from
  `shared/bundling-defaults.ts` (adds `'@prisma/client'` to `externalModules`).
- Delete `prisma-layer.ts`, the `.prisma-layer-build/` tree, and `Layers: [prismaLayer]`.
- Adjust `connection_limit` to keep Lambda concurrency × pool ≤ RDS `max_connections`.
- **Pros:** smallest PR; no version bump risk; preserves `seed.ts`, `migrations-lambda.ts`,
  and `prisma-client.ts` shapes; local dev unchanged; bundling-defaults stays valid.
- **Cons:** keeps the Rust query-engine binary requirement on the BC Lambdas, which
  is exactly the class of bug that motivated this change; the user's stated intent
  ("upgrade to Rust-free Prisma") is not satisfied; future Prisma versions drop
  the legacy engine.
- **Effort:** Small (≤ 200 LOC across infra).

### Option B — Upgrade to Prisma 6.x + `@prisma/adapter-pg` (Rust-free, GA) — RECOMMENDED

- Bump `prisma` and `@prisma/client` to `^6.x` (latest 6.x stable at the time of
  `sdd-propose`); confirm `@prisma/adapter-pg` and `pg` peer-dep version range
  in the proposal phase via `context7`.
- Schema generator change in `packages/backend/prisma/schema.prisma`:
  `provider = "prisma-client"`, `engineType = "client"`, `output` pinned to
  `packages/backend/src/generated/prisma` (or a sibling `generated/`), optional
  `moduleFormat = "esm"`, `runtime = "nodejs"`, `generatedFileExtension = "ts"`.
- Drop `binaryTargets` (no native binary to ship). Drop the pnpm-store `output`.
- Add `@prisma/adapter-pg` and `pg` to `packages/backend` deps. Remove
  `@prisma/engines` from the migrations Lambda bundle (no longer needed).
- Rewrite `packages/backend/src/shared/prisma-client.ts` to:
  - Import `PrismaClient` from the generated client path, not from `@prisma/client`.
  - Accept an injected `adapter` parameter (default: build one from `DATABASE_URL`).
  - Keep the singleton via `globalThis`, the stage-aware `sslmode`, and the
    exported pure `buildPrismaUrl()` helper.
- Rewrite `scripts/dev-server.ts` so the local path uses the same factory and
  adapter (no behavior change — same `PrismaClient` instance, same DATABASE_URL).
- Rewrite `packages/infra/src/constructs/migrations.ts` to:
  - Bundle `prisma` CLI only (no `@prisma/engines`); keep the
    `commandHooks.beforeBundling` + `prisma generate` approach; keep
    `HOME=/tmp`; simplify the `sed` patch since `output` is now an
    author-controlled path under the bundle.
- Remove `prisma-layer.ts` and the `.prisma-layer-build/` tree. Gitignore the
  build directory.
- Restore pgvector in `DatabaseStack.ts` (parameter group + tag) — this was
  dropped by mistake in the uncommitted diff.
- **Pros:** drops the entire class of binary-mismatch bugs; aligns with the
  user's stated direction; Prisma 6.16+ GA (verified via context7) means no
  `previewFeatures = ["driverAdapters"]` required; `connection_limit` semantics
  move to the adapter (clearer ownership); same code path for local + Lambda +
  migrations; future-proof against the Prisma 7.x pivot to URL-from-config.
- **Cons:** requires regenerating the client (new output dir, new import surface
  for the 4 `import type { PrismaClient }` call sites and the 1
  `import { PrismaClient }` call site); touches all 5 BC Lambdas via the shared
  factory; touches `seed.ts`; touches the migrations Lambda bundle.
- **Effort:** Medium (300–500 LOC across backend + infra + test fixtures,
  concentrated in `prisma-client.ts` rewrite and `schema.prisma` generator
  block; the rest is mechanical).

### Option C — Migrate away from Prisma (Drizzle ORM + `pg`)

- Drop Prisma entirely; Drizzle ORM with `pg` driver.
- **Pros:** greenfield-ideal stack per the previous-session memory observation;
  no native engine at all; smaller bundle.
- **Cons:** rewrites every repository (Prisma → Drizzle query builder), every
  migration, and the seed; out of scope for the current blocker; high risk;
  not aligned with the user's stated preference for keeping Prisma.
- **Effort:** High (1000+ LOC across backend, infra, tests).

### Option D — Add RDS Proxy on top of Option A or B

- Stand up RDS Proxy in front of `t3.micro` and re-route Lambdas through it.
- **Pros:** shields RDS from connection storms; pgbouncer-style multiplexing.
- **Cons:** **RDS Proxy is NOT free tier eligible** (~$0.015/ACU-hour per
  region, minimum 2 ACU = ~$22/month); user's explicit preference (per session
  prompt "este ultimo tiene costo adicional en la cama free tier?") was to
  avoid adding cost; not justified at MVP scale; would be a separate follow-up
  change if load ever demands it.
- **Effort:** Small once decided (CDK `rds.DatabaseProxy` + new IAM auth +
  secret rotation tweaks), but cost-prohibitive for this change's scope.

---

## 5. Recommended target architecture (Option B)

```
┌──────────────────────────────────────────────────────────────────────┐
│  packages/backend/prisma/schema.prisma                               │
│  generator client {                                                  │
│    provider = "prisma-client"     # NOT prisma-client-js             │
│    engineType = "client"          # Rust-free WASM                    │
│    output = "../src/generated/prisma"                                │
│    runtime = "nodejs"                                                │
│    moduleFormat = "esm"                                              │
│  }                                                                   │
│  datasource db { provider = "postgresql" url = env("DATABASE_URL") } │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  prisma generate (postinstall)
┌──────────────────────────────────────────────────────────────────────┐
│  packages/backend/src/generated/prisma/        # generated, gitignored│
│   ├── client.ts        (PrismaClient + model types)                  │
│   └── ...                                                           │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  import { PrismaClient } from '../generated/prisma'
┌──────────────────────────────────────────────────────────────────────┐
│  packages/backend/src/shared/prisma-client.ts (FACTORY)              │
│   - globalThis.__mercadoExpressPrisma (singleton)                    │
│   - accepts injected adapter or builds PrismaPg from DATABASE_URL    │
│   - stage-aware sslmode (preserve buildPrismaUrl)                    │
│   - pool size = stage-aware (dev: 2, prod: 2, localstack: 2)        │
└──────────────────────────────────────────────────────────────────────┘
       │                            │                          │
       ▼ local                      ▼ AWS                      ▼ migrations
  scripts/dev-server.ts         BC Lambda                Lambda CR
  (tsx on host)                 (esbuild bundles         (CLI bundled in
   pg.Pool via @prisma/         @prisma/adapter-pg +    container; calls
   adapter-pg directly)         pg bundled into          prisma migrate
                                /var/task/node_modules/  deploy + seed)
```

### Concrete change surface for the proposal

| Layer             | File                                                                     | Change                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema            | `packages/backend/prisma/schema.prisma`                                  | Generator block rewrite. Remove `binaryTargets` and the pnpm-store `output`. Add `previewFeatures = []` is unnecessary in 6.16+.                                                                                                                        |
| Backend deps      | `packages/backend/package.json`                                          | Bump `prisma` + `@prisma/client` to `^6.x`. Add `@prisma/adapter-pg` and `pg`. Update pnpm-lock via `pnpm install` (will happen in `sdd-apply`).                                                                                                        |
| Factory           | `packages/backend/src/shared/prisma-client.ts`                           | Rewrite: import `PrismaClient` from `../generated/prisma/client`; accept `{ adapter }` in options; build `new PrismaPg({ connectionString })` from `DATABASE_URL` when no adapter injected. Keep `buildPrismaUrl()`, `getPrismaClient()`, `PrismaLike`. |
| Type-only imports | 4 call sites using `import type { PrismaClient }` from `@prisma/client`  | Replace with `import type { PrismaClient } from '../generated/prisma/client'` (path varies per file). Re-export `PrismaClient` from `src/shared/prisma-client.ts` to minimize churn.                                                                    |
| Seed              | `packages/backend/prisma/seed.ts`                                        | Same import path change. No other behavior change.                                                                                                                                                                                                      |
| Infra             | `packages/infra/src/constructs/migrations.ts`                            | Remove `@prisma/engines` from `commandHooks` `npm install` line. Keep `prisma` CLI install + `prisma generate` + `HOME=/tmp`. Simplify or remove the `sed` patch (output is now author-controlled under the bundle).                                    |
| Infra             | `packages/infra/src/shared/bundling-defaults.ts`                         | Remove `prismaClientBundling` export (no longer needed: `@prisma/client` bundles fine, or externalize via `['aws-sdk']` only). Rewrite `prismaMigrationsBundling` body for Prisma 6.x.                                                                  |
| Infra             | `packages/infra/src/stacks/ApiStack.ts`                                  | Remove `import { createPrismaLayer }`, the `createPrismaLayer(this, 'PrismaLayer')` call, and `layers: [prismaLayer]`. Drop the misleading "bundled from backend schema" comments. Keep `bundling: { externalModules: ['aws-sdk'] }`.                   |
| Infra             | `packages/infra/src/stacks/DatabaseStack.ts`                             | Restore the pgvector `parameterGroup` (`shared_preload_libraries: vector`) and the `ExtensionVector` CFN tag — these were dropped in the uncommitted diff but are still locked in `openspec/config.yaml`.                                               |
| Infra             | `packages/infra/src/constructs/prisma-layer.ts` + `.prisma-layer-build/` | Delete. Gitignore the build directory.                                                                                                                                                                                                                  |
| Infra             | `packages/infra/test/constructs/api-stack.test.ts`                       | Reintroduce the reserved-concurrency assertion with the correct expectation (or, in the proposal, explicitly decide whether `dev: 1` is restored and align the test).                                                                                   |
| Infra tests       | `packages/infra/test/constructs/database-stack.test.ts`                  | Add explicit assertion for the pgvector parameter group restoration.                                                                                                                                                                                    |
| Backend tests     | `packages/backend/test/shared/prisma-client.*.test.ts`                   | New RED test for adapter injection. Update existing 8 tests to assert adapter wiring.                                                                                                                                                                   |
| Docs              | `docs/LOCAL-DEV.md`, `README.md`                                         | Update troubleshooting entry for Prisma version. Add adapter-pool guidance.                                                                                                                                                                             |
| Deploy            | `packages/infra/package.json`                                            | Restore `-c stage=dev` in `deploy:dev`.                                                                                                                                                                                                                 |

---

## 6. Local compatibility plan

| Concern                          | Today                                                                                                                                                      | After change                                                                                                                                                                          | Verification                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local Postgres                   | `docker-compose.dev.yml` runs `postgres:16` container on `localhost:5432`                                                                                  | Unchanged. Postgres image, init scripts, port, volumes are not touched.                                                                                                               | `pnpm dev:up` starts the container; `pg_isready` healthcheck passes.                                                                                                                                                                 |
| Local DATABASE_URL               | `postgresql://ceiba:ceiba_dev@postgres:5432/mercadoexpress` via `.env.dev`                                                                                 | Unchanged. `buildPrismaUrl` preserves `sslmode=disable` for `STAGE=localstack`.                                                                                                       | `pnpm dev:api` boots; `getPrismaClient()` returns a client connected to the local Postgres.                                                                                                                                          |
| Prisma migration on local        | `pnpm db:migrate` runs `dotenv -e ../../.env.dev -- prisma migrate deploy`                                                                                 | Same command works against Prisma 6.x CLI; migrations directory `packages/backend/prisma/migrations/` is the same source of truth.                                                    | `pnpm db:migrate` exits 0 against the running container.                                                                                                                                                                             |
| Local seed                       | `pnpm db:seed` runs `tsx prisma/seed.ts`                                                                                                                   | Same — `seed.ts` continues to import from `@prisma/client`; only the import source changes from the npm package to the generated path. The `dotenv` bootstrap block at the top stays. | `pnpm db:seed` exits 0; admin user + 6 categories + 6 products land in the local DB.                                                                                                                                                 |
| Dev server wrapping real Lambdas | `scripts/dev-server.ts` dynamically imports each `LAMBDAS[i].entry` and invokes the real `handler` against an `APIGatewayProxyEventV2` synthesized locally | Unchanged. Each BC Lambda's bootstrap imports `getPrismaClient()` from `shared/prisma-client.ts`, which now builds the same `PrismaPg` adapter the AWS Lambda does.                   | `pnpm dev:api` boots; `curl -X POST http://localhost:3001/api/v1/auth/login -d '{"username":"admin","password":"..."}' -H 'content-type: application/json'` returns 200 + JWT (or 401 for bad credentials, matching AWS smoke test). |
| Local test execution             | `packages/backend/test/shared/*` runs against the real `prisma-client.ts` factory using `vi.stubEnv` for `DATABASE_URL` / `STAGE`                          | New tests assert adapter wiring; existing 8 sslmode tests stay green (their assertions are about URL composition, not engine type).                                                   | `pnpm --filter backend test` exits 0.                                                                                                                                                                                                |
| Layer build directory            | `.prisma-layer-build/` exists in source tree (untracked but committed-style `.gitkeep`)                                                                    | Deleted; `.gitignore` entry added for any future scratch dirs.                                                                                                                        | `git status` shows no untracked files in `packages/infra/src/constructs/.prisma-layer-build/`.                                                                                                                                       |
| Docker bundle container          | `node:20-bullseye-slim` from `aws-lambda-nodejs`                                                                                                           | Unchanged.                                                                                                                                                                            | Bundling still succeeds on the host's esbuild fallback path (which already runs locally per the prior CDK bundling discovery).                                                                                                       |

---

## 7. AWS migration execution plan

### Boundary principle

Migrations MUST run **outside** every BC Lambda. The migrations CustomResource
Lambda is the only place `prisma migrate deploy` is invoked. The BC Lambdas and
the dev server never run `prisma migrate`.

### Pre-deploy ordering (existing, preserved)

```
DatabaseStack         → creates VPC, Secrets, RDS instance
  └── MigrationsCustomResource Lambda (DependsOn: DbSecret, AdminSecret, RDS instance)
       → prisma migrate deploy
       → prisma seed (tsx prisma/seed.ts)
ApiStack              → HttpApi, 5 BC Lambdas (DependsOn: DatabaseStack)
ObservabilityStack    → SNS topic + alarms (DependsOn: ApiStack)
FrontendStack         → CloudFront (DependsOn: ApiStack)
```

`MigrationsCustomResource` already declares explicit `cfnFn.addDependency(...)`
edges (`migrations.ts:153–157`) so CloudFormation does not resolve
`{{resolve:secretsmanager:...}}` tokens before the DB exists.

### What changes for Prisma 6.x

1. **No `@prisma/engines` in the migrations bundle.** Drop the line in
   `commandHooks.beforeBundling`. The Rust-free `prisma` CLI does not need the
   engines package.
2. **No `sed` patch of the schema `output` path.** With the new generator
   block (`output = "../src/generated/prisma"` relative to `prisma/`), the
   generated client lands inside the bundle naturally — esbuild can resolve
   it at Lambda runtime via the standard relative path.
3. **No `binaryTargets`** in the schema.
4. **Add a small post-bundling step** that copies the generated client from
   `packages/backend/src/generated/prisma/` into the migrations bundle (similar
   to how `schema.prisma` and `seed.ts` are copied today).
5. **Verify the `HOME=/tmp` env vars stay** — Prisma 6.x still uses
   `~/.cache/prisma` and Lambda's `HOME` is unwritable.
6. **Reserve concurrency** is a separate concern (see §8 Risk R-3). Out of
   scope for this change unless the proposal explicitly bundles it.

### Deploy-time verification (must run during `sdd-apply`)

1. `cdk synth --all -c stage=dev` succeeds with no diff in
   `packages/infra/src/constructs/.prisma-layer-build/` (the dir is gone).
2. `cdk deploy --all -c stage=dev --require-approval never` reaches
   `UPDATE_COMPLETE` for every stack.
3. The migrations CustomResource reports `Status: SUCCESS` in CloudWatch logs
   of `MercadoExpress-dev-prisma-migrate-and-seed`.
4. Smoke test (`POST /api/v1/auth/login` with bad credentials) returns
   `HTTP 401` (not `HTTP 500`). A valid login returns `HTTP 200` + JWT.
5. `aws logs tail /aws/lambda/MercadoExpress-dev-auth-lambda --follow` shows
   no `Query Engine (Node-API) Lib Query Engine could not be located` errors.

### Rollback contract

The change is purely additive at the contract layer (same `getPrismaClient()`
export signature, same `DATABASE_URL` env var, same routes). A rollback reverts
to the previous Prisma 5.x client + Layer shape. The migrations directory
itself is unaffected. The pgvector parameter group restoration is additive
(turning it off later is a separate CDK patch).

---

## 8. Risks and open decisions

| ID   | Severity     | Title                                                                                   | Evidence / decision needed                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | **CRITICAL** | Layer in current diff is dead on the runtime path                                       | `prisma-layer.ts` ships engine at `/opt/nodejs/node_modules/`; Prisma's lookup sequence starts from CWD `/var/task/` and walks `node_modules`. The Layer does not fix the pnpm-store output path bug.                                                                                                                                                                  |
| R-2  | **CRITICAL** | `schema.prisma:64` `output` path is unreachable at Lambda runtime                       | Confirmed: pnpm-store hash path does not exist under `/var/task/`. Any solution that keeps the current generator block is a workaround, not a fix.                                                                                                                                                                                                                     |
| R-3  | **HIGH**     | No reserved concurrency on any Lambda                                                   | `config.ts:100–106` `undefined` for all stages. With `t3.micro` `max_connections≈113` and 5 BC Lambdas × default 1000 concurrent, a single burst exhausts RDS. **Open decision** — keep `dev: 1` per ADR-9 (with the alarm fallback), keep `undefined` everywhere, or set per-Lambda values. The current `api-stack.test.ts` diff deletes the only test guarding this. |
| R-4  | **HIGH**     | No `DatabaseConnections` CloudWatch alarm                                               | `ObservabilityStack.ts` never references `DatabaseConnections` or `FreeableMemory`. Without an alarm, the pool exhaustion in R-3 fails silently. **Open decision** — add the alarm in this change or a follow-up.                                                                                                                                                      |
| R-5  | **HIGH**     | pgvector regression in uncommitted diff                                                 | `DatabaseStack.ts:154–168` (in HEAD) and `parameterGroup: shared_preload_libraries: vector` (in HEAD) are removed in the uncommitted diff. `openspec/config.yaml:90` and `DatabaseStack.ts:13` lock the extension. Must be restored (ADAPT) in this change.                                                                                                            |
| R-6  | **MEDIUM**   | `@prisma/adapter-pg` peer-dep on `pg` not yet pinned                                    | `packages/backend/package.json` does not list `pg` or `@types/pg`. Add both in `sdd-apply`.                                                                                                                                                                                                                                                                            |
| R-7  | **MEDIUM**   | `dev:up` `concurrently -k` race still broken                                            | `docs/LOCAL-DEV.md:26–27` documents the workaround (`dev:api` + `dev:web` in separate terminals). Unrelated to this change but the path forward does not regress it.                                                                                                                                                                                                   |
| R-8  | **MEDIUM**   | Three-schema drift (backend, Layer, migrations Lambda)                                  | Solved by Option B (drop the Layer and the bundled schema). After change, the source schema is the only schema.                                                                                                                                                                                                                                                        |
| R-9  | **MEDIUM**   | Local `pnpm db:seed` requires `.env.dev` and dotenv bootstrap                           | `seed.ts:48–54` already loads `.env.dev` / `.env.dev.example` / `.env` in priority order. No change needed, but worth a regression test in `sdd-apply`.                                                                                                                                                                                                                |
| R-10 | **LOW**      | `--all` deploy needs `cdk deploy --all -c stage=<stage>`                                | The uncommitted `deploy:dev` lost `-c stage=dev` and relies on the CLI default. Restore the explicit flag.                                                                                                                                                                                                                                                             |
| R-11 | **LOW**      | `engines-version` is gone in Prisma 6.x                                                 | Verified via context7: `@prisma/engines-version` no longer exists in 6.x. Any `engines-version` reference in tests must be removed.                                                                                                                                                                                                                                    |
| R-12 | **LOW**      | Test `prisma-client.*.test.ts` files referenced in earlier sessions don't exist on disk | `glob packages/backend/test/**/prisma-client*` returns nothing. Either the previous-session test files were never committed (they should land as part of `add-localstack-dev-env`) or they live under a different path. The proposal must verify test coverage exists before claiming "tests stay green".                                                              |
| R-13 | **LOW**      | Local dev `pg-mem` usage                                                                | `packages/backend/package.json:32` declares `pg-mem`. No code currently uses it. Could be useful for offline tests in the new adapter world (e.g. fake `pg.Pool` to avoid spinning Docker in CI). Not a blocker.                                                                                                                                                       |

### Open decisions (carry forward to `sdd-propose`)

- **D-1:** Exact Prisma 6.x version range (`^6.16` recommended; the latest 6.x
  is the current LTS track). Confirm via `context7` at proposal time.
- **D-2:** Generated client output directory. Two reasonable choices:
  `packages/backend/src/generated/prisma/` (sibling to `src/shared/`) or
  `packages/backend/prisma/generated/`. The sibling-to-src option follows
  context7 examples; the prisma-sibling option keeps generated code next to
  schema. Default to sibling-to-src.
- **D-3:** Externalize `@prisma/adapter-pg` + `pg` from BC Lambda bundles
  (smaller bundle, faster cold start) or bundle them (one less moving piece)?
  Default to externalize via `externalModules: ['aws-sdk', '@prisma/client',
'@prisma/adapter-pg', 'pg']`.
- **D-4:** Reserved concurrency for dev. Three options: restore `dev: 1` per
  ADR-9 + alarm; set per-Lambda values; leave undefined. Default to restoring
  `dev: 1` and treating the open `lambda_reserved_concurrency` question as
  resolved for dev only.
- **D-5:** Pool size strategy. With `t3.micro` ceiling ≈ 113 connections and
  `reservedConcurrentExecutions = 1` per Lambda × 5 BC Lambdas, the maximum
  sustained concurrency is 5. `connection_limit = 2` per Lambda (current) =
  10 connections max. Conservative. For prod, scale `max_connections` first
  (db.t3.small or db.t4g.medium) before raising the pool.
- **D-6:** Whether to add a `DatabaseConnections` alarm in this change or a
  follow-up. Default to follow-up to keep this change focused on the Prisma
  upgrade.

---

## 9. Review workload forecast

| Slice                                                                                                             | Estimated changed lines                         | Within budget? |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------- |
| `packages/backend/prisma/schema.prisma` (generator block rewrite)                                                 | ~10                                             | ✓              |
| `packages/backend/src/shared/prisma-client.ts` (factory rewrite, tests)                                           | ~150                                            | ✓              |
| `packages/backend/src/{auth,products,categories,inventory,alerts,orders}/bootstrap.ts` import path swap           | ~30                                             | ✓              |
| `packages/backend/prisma/seed.ts` (import path swap)                                                              | ~2                                              | ✓              |
| `packages/backend/test/shared/prisma-client.*.test.ts` (new RED tests)                                            | ~120                                            | ✓              |
| `packages/infra/src/constructs/migrations.ts` (drop `@prisma/engines`, simplify sed patch, copy generated client) | ~60 net (mostly deletion)                       | ✓              |
| `packages/infra/src/shared/bundling-defaults.ts` (rewrite for 6.x)                                                | ~80 net                                         | ✓              |
| `packages/infra/src/stacks/ApiStack.ts` (remove layer wiring, fix deploy comment)                                 | ~15 net (mostly deletion)                       | ✓              |
| `packages/infra/src/stacks/DatabaseStack.ts` (restore pgvector)                                                   | ~20 net                                         | ✓              |
| `packages/infra/src/constructs/prisma-layer.ts` + `.prisma-layer-build/` (delete)                                 | ~120 deletions                                  | ✓              |
| `packages/infra/test/constructs/api-stack.test.ts` (restore reserved concurrency test)                            | ~15 net                                         | ✓              |
| `packages/infra/test/constructs/database-stack.test.ts` (pgvector assertion)                                      | ~10 net                                         | ✓              |
| `docs/LOCAL-DEV.md`, `README.md`, `runbook/*` (Prisma version note + adapter guidance)                            | ~30 net                                         | ✓              |
| **TOTAL**                                                                                                         | **≈ 660 changed lines (deletions + additions)** | **⚠ over 400** |

**Decision needed before apply:** Yes — over the 400-line review budget by ~65%.
**Chained PRs recommended:** Yes — split into 3 chained PRs (see below).
**400-line budget risk:** **Medium** (manageable with chaining; **High** if shipped as one PR).

### Recommended chained-PR split (carry to `sdd-tasks`)

| PR                                                                                            | Title                                                                                                                                                                                                                                                   | Files | Approx LOC                                                                       | Goal |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- | ---- |
| PR 1 — `fix(infra): restore pgvector parameter group + reintroduce reserved concurrency test` | `DatabaseStack.ts`, `database-stack.test.ts`, `api-stack.test.ts`, `config.ts` (reservedConcurrency = 1 for dev), `ObservabilityStack.ts` (no behavioral change)                                                                                        | ~50   | Unblock pgvector regression and the deleted ADR-9 test. No Prisma changes.       |
| PR 2 — `feat(backend,infra): upgrade to Prisma 6.x Rust-free client + @prisma/adapter-pg`     | `schema.prisma`, `prisma-client.ts`, `seed.ts`, 7 import path swaps, `bundling-defaults.ts`, `migrations.ts`, `ApiStack.ts` (drop layer line), delete `prisma-layer.ts` + `.prisma-layer-build/`, new `prisma-client.*.test.ts`, lockfile, backend deps | ~480  | The actual upgrade. Touches every BC bootstrap and the migrations Lambda.        |
| PR 3 — `docs(prisma): update README + LOCAL-DEV for Prisma 6.x + adapter pool`                | `README.md`, `docs/LOCAL-DEV.md`, `runbook/*`                                                                                                                                                                                                           | ~30   | Documentation parity.                                                            |
| Optional PR 4 — `feat(observability): add DatabaseConnections + FreeableMemory alarms`        | `ObservabilityStack.ts`, new test                                                                                                                                                                                                                       | ~60   | Out of scope for the upgrade; only ships if the proposal bundles D-6 into "Yes". |

`Decision needed before apply: Yes` — `sdd-tasks` MUST split into chained PRs.
`Chained PRs recommended: Yes`.
`400-line budget risk: Medium` (single PR would be High; chained PRs keep each slice
under 400).

---

## 10. Verdict

**Ready for Proposal: Yes.**

The investigation confirmed:

- The current Layer approach (`prisma-layer.ts` + `.prisma-layer-build/`) is
  dead code on the runtime path because esbuild bundles `@prisma/client` into
  every BC Lambda and the bundled code resolves through the pnpm-store `output`
  path in `schema.prisma:64`.
- Prisma 6.16+ has Rust-free + driver-adapter GA (verified via context7 from
  the official Prisma docs), so `@prisma/adapter-pg` + the new
  `prisma-client` provider is the durable fix.
- Local compatibility (Postgres container, `dev-server.ts`, seed, migrate
  command, scripts) is preserved by keeping `getPrismaClient()` as the
  single factory and updating its internals only.
- The migrations Lambda can stay self-contained; the change is a simplification
  (drop `@prisma/engines`, drop the `sed` patch, copy the generated client
  into the bundle).
- RDS Proxy is correctly out of scope for Free Tier (verified: not Free Tier
  eligible, ≈ $22/month minimum, not justified at MVP scale).
- The uncommitted diff has one correctness regression (pgvector dropped in
  `DatabaseStack.ts`) and one test regression (`api-stack.test.ts` ADR-9
  test deleted); both are recoverable in this change.

`next_recommended`: **`sdd-propose`** (with the chained-PR split carried
forward as the recommended `delivery_strategy`).

---

**Metadata**

| Field                                   | Value                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                                  | COMPLETE                                                                                                                                                                                                                                                                                                                     |
| `skill_resolution`                      | `paths-injected` — both `sdd-explore/SKILL.md` and `cognitive-doc-design/SKILL.md` were listed in the orchestrator's "Skills to load before work" block and were read before this artifact was produced.                                                                                                                     |
| `git status` before                     | 8 tracked files modified (32 insertions, 103 deletions), 1 added-then-deleted `.gitkeep` (`AD`), 4 untracked paths under `openspec/changes/prisma-lambda-rds-fix/` (explore.md), `packages/infra/src/constructs/.prisma-layer-build/nodejs/`, `packages/infra/src/constructs/prisma-layer.ts`, `packages/infra/src/shared/`. |
| `git status` after (this artifact only) | Identical to "before" plus the updated `openspec/changes/prisma-lambda-rds-fix/exploration.md` (this file). No source, config, test, or workflow file was modified, staged, or committed. No deploys, migrations, seeds, installs, package updates, formatters, or tests were executed.                                      |
| `next_recommended`                      | `sdd-propose`                                                                                                                                                                                                                                                                                                                |

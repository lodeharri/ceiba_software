# Proposal: prisma-lambda-rds-fix

## Intent + Scope

BC Lambdas fail: esbuild bundles `@prisma/client` whose `output` is unreachable under `/var/task/`. Layer is dead (Prisma never searches `/opt/nodejs/`). Diff regresses pgvector, deletes ADR-9, adds no `DatabaseConnections` alarm. `db.t3.micro` (~113 max) + unbounded concurrency = silent RDS exhaustion. Change adopts Rust-free Prisma 6.x + `@prisma/adapter-pg`, restores regressions, adds a connection guard.

**In scope.**

- Pin Prisma 6.x (floor 6.17+, **exact latest 6.x patch pinned in design, never caret**); generator `prisma-client` + `engineType = "client"` output `backend/src/generated/prisma`; drop `binaryTargets` + pnpm-store `output`. Files: `schema.prisma`, `package.json`, lockfile.
- Add `@prisma/adapter-pg`, `pg`, `@types/pg`; `PrismaPg` → `PrismaClient({ adapter })`; URL `connection_limit=2` → `pg.Pool({ max: 2 })`; `sslmode` preserved; single `getPrismaClient({ adapter? })` factory. Files: `prisma-client.ts`, `seed.ts`, 5× `bootstrap.ts`.
- `MigrationsCustomResource` failure propagates and **blocks deploy**; schema, migrations, data preserved; no reset. Files: `infra/src/constructs/migrations.ts`, `shared/bundling-defaults.ts`.
- Direct-RDS guard: `max: 2`, dev `reservedConcurrentExecutions = 1`, `DatabaseConnections` alarm at 80% of `max_connections`. Files: `infra/src/stacks/{Api,Database,Observability}Stack.ts`, `config.ts`.
- Restore pgvector, ADR-9, `-c stage=dev`. Local Docker/dev-server/migrate/seed preserved. Tests restore ADR-9 + pgvector + adapter RED tests.
- `prisma-layer.ts` + `.prisma-layer-build/` **REMOVE-LATER**.

**Out of scope.** RDS Proxy (cost), ORM swap, destructive `prisma migrate reset`, frontend, AI adapters, Layer deletion during planning.

## Capabilities

- **`prisma-postgres-runtime`**: Rust-free Prisma 6.x runtime shared by local dev, BC Lambdas, migrations, seed.
- **`database-deployment-safety`**: migrate/seed failure fails CFN; data + history preserved; no reset.
- **`direct-rds-connection-guard`**: adapter `max: 2`, dev reserved concurrency 1, `DatabaseConnections` alarm.

Modified: none. No `openspec/specs/` directory (verified).

## Risks

- **Wrong 6.x generator (Med).** Pin exact latest 6.x in design (never caret); Context7 verify.
- **Migration CLI mis-specified (Med).** UNDECIDED until design verifies; CFN blocks on failure.
- **Review overrun ~660 LOC + worktree drop (Med-High).** After `sdd-tasks`: ask user chained PRs vs size exception. REMOVE-LATER; disposition table; git-status each slice. No commits until verified.

## Rollback + Dependencies

Revert PRs in reverse order. Factory signature, `DATABASE_URL`, HTTP contract unchanged → API-layer forward compatibility. pgvector + alarm additive. Migrations + seed untouched. Dependencies: Context7 verify exact latest Prisma 6.x + 6.x generator; `@prisma/adapter-pg` + `pg` peer-dep with pinned Prisma; existing `MigrationsCustomResource` stack ordering.

## Success Criteria

- [ ] Local `dev:up`, `db:migrate`, `db:seed`, `dev:api` succeed; `vitest` green; coverage ≥ 80% on `domain`/`application`.
- [ ] `tsc --noEmit`, `eslint`, `cdk synth --all -c stage=dev` succeed; dev deploy `UPDATE_COMPLETE`; FAILS if `MigrationsCustomResource` = `FAILED`.
- [ ] Login → 401 bad / 200 valid; never 500; no `Query Engine` / `Schema Engine` errors; `DatabaseConnections` alarm present; dev reserved concurrency = 1; ADR-9 + pgvector assertions green; migrations + data preserved; each task slice ≤ 400 lines; no commits until verified.

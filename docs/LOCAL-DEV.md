# Local Development

PostgreSQL runs in Docker; start everything with `pnpm dev` (api + web in separate terminals).; the wrapper-native dev server
(`scripts/dev-server.ts`) and Vite run on the host with hot reload. This doc
covers the happy path, what runs where, troubleshooting, and how to reset.

## Prerequisites

- **Node.js >= 20** and **pnpm 9** (`corepack enable pnpm` once).
- **Docker 24+** with Compose v2 (`docker compose version` should print v2.x).
- About **1.5 GB of free RAM** for postgres + Vite + dev server.
- Ports free on the host: **3001** (dev server), **5173** (Vite), **5432** (postgres).
  Override in `.env.dev` if any collide (see [Troubleshooting](#troubleshooting)).

## First run

```bash
cp .env.dev.example .env.dev   # one-time copy; defaults are functional
pnpm install                   # workspace deps
pnpm build                    # compile @mercadoexpress/shared to dist/
pnpm setup                    # docker up + drizzle-kit migrate + seed
# then: pnpm dev:api + pnpm dev:web (pnpm dev is broken - use separate terminals)
```

> Note: `pnpm dev` (all-in-one) is currently broken due to a `concurrently -k` race
> with `dev:up` (one-shot). Use `pnpm dev:api` + `pnpm dev:web` in separate terminals.

Open <http://localhost:5173> for the SPA. The login screen talks to
<http://localhost:3001/api/v1> (the dev server), which talks to `localhost:5432` (postgres).

## What runs where

| Command          | Runs on              | Port | Purpose                                                |
| ---------------- | -------------------- | ---- | ------------------------------------------------------ |
| `pnpm dev`       | --                   | --   | BROKEN -- use `pnpm dev:api` + `pnpm dev:web` instead. |
| `pnpm dev:up`    | docker               | --   | Starts postgres container (waits for health).          |
| `pnpm dev:api`   | host (`tsx --watch`) | 3001 | HTTP wrapper that invokes Lambda handlers.             |
| `pnpm dev:web`   | host (`vite`)        | 5173 | Vue 3 SPA with HMR.                                    |
| `pnpm dev:down`  | docker               | --   | Stops postgres container (keeps volumes).              |
| `pnpm dev:reset` | host + docker        | --   | `dev:down -v` plus clears the Vite cache.              |

URLs once everything is up:

| Service           | URL                                                  |
| ----------------- | ---------------------------------------------------- |
| SPA (Vite)        | <http://localhost:5173>                              |
| Dev server API    | <http://localhost:3001/api/v1>                       |
| Dev server health | <http://localhost:3001/api/v1/health>                |
| PostgreSQL        | `localhost:5432` (user `ceiba`, db `mercadoexpress`) |

## Troubleshooting

### Vite serves a stale module after a config change

Symptoms: edits to `vite.config.ts`, `vite-env.ts`, or anything in
`vite-plugins/` don't take effect; the dev server keeps the old behaviour.

Fix:

```bash
rm -rf packages/frontend/node_modules/.vite
pnpm dev:web
```

`pnpm dev:reset` does this for you.

### Build fails with `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md`

The `envValidation()` Vite plugin fires whenever `VITE_API_BASE_URL` is unset or empty.
The fix is to set it explicitly:

```bash
# Either edit packages/frontend/.env.development:
VITE_API_BASE_URL=http://localhost:3001/api/v1

# Or pass it inline:
VITE_API_BASE_URL=http://localhost:3001/api/v1 pnpm -C packages/frontend build
```

### Port already in use (3001, 5173, 5432)

Identify the holder and stop it:

```bash
ss -ltnp 'sport = :3001 or sport = :5173 or sport = :5432'
```

If you cannot free the port, override it in `.env.dev` (`POSTGRES_PORT`,
`FRONTEND_PORT`, `DEV_SERVER_PORT`) -- every port is configurable.

### DB not ready when `dev:api` starts

`pnpm dev:up` waits on the postgres healthcheck before exiting, so by the
time the runner reaches `dev:api` the DB should already be accepting
connections. If you see connection-refused errors during the first ~10
seconds, give it a moment -- the AWS SDK retry policy in the wrapper-native
dev server will retry automatically.

If it persists:

```bash
docker compose -f docker-compose.dev.yml ps            # confirm 'healthy'
docker compose -f docker-compose.dev.yml logs postgres # check for init errors
```

## Reset

Full reset (containers + named volumes + Vite cache):

```bash
pnpm dev:reset
```

What that clears:

- `postgres` container (stopped and removed).
- `pgdata` named volume (Postgres data).
- `packages/frontend/node_modules/.vite` (Vite module cache).

Power users can run the steps individually:

```bash
pnpm dev:down                        # stop only
docker compose -f docker-compose.dev.yml down -v   # stop + drop volumes
rm -rf packages/frontend/node_modules/.vite        # clear Vite cache
```

## CI/CD

### Migrations and seed

Migrations and seed run in **GitHub Actions CI**, not as a CDK Custom Resource.
The workflow lives in `.github/workflows/migrate.yml` and runs:

1. `pnpm --filter backend db:migrate` -- Drizzle schema changes via `drizzle-kit migrate`
2. `pnpm --filter backend db:seed` -- idempotent seed upserts

**Trigger:**

- Manual: `workflow_dispatch` with stage selector (dev / prod)
- Automatic: push to `main` when `packages/backend/src/db/**`, `drizzle/**`, or
  `drizzle.config.ts` changes

**AWS access:** uses the same OIDC role as `deploy-dev.yml` (`OIDC_ROLE_ARN`
GitHub environment secret). The workflow reads `DATABASE_URL` from
`MercadoExpress-{stage}-db-master` in AWS Secrets Manager.

### Deploy only

Infrastructure deploy (CDK stacks, no DB changes):

```bash
# Dev
cd packages/infra && pnpm exec cdk deploy MercadoExpress-dev --require-approval never
```

Or push to `main` and the `deploy-dev.yml` workflow handles it.

## Next step

Start infrastructure first (`pnpm dev:up`), then in separate terminals run
`pnpm dev:api` and `pnpm dev:web`. Open <http://localhost:5173> and the
login screen will guide you from there. If anything in this doc is wrong or
missing, the reset recipe is `pnpm dev:reset` -- that always gets you back to
a clean state.

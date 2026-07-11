# MercadoExpress

Inventory management system for a retail chain. Technical test: deployable +
tested. Source of truth lives in `porject.md` (RF-01..RF-06, business rules,
reference data).

## Stack

- **Language:** TypeScript 5.x (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`).
- **Monorepo:** pnpm workspaces, Node ≥ 20, pnpm 9.
- **Backend:** AWS Lambda (no Express/Fastify/NestJS) + AWS API Gateway HTTP
  API v2 + Amazon RDS for PostgreSQL 16 with the pgvector extension. Prisma
  as ORM. `jose` for JWT (HS256, 24h, dual-secret rotation). `bcrypt` for
  password hashing (cost 10). `pino` for structured logging.
- **Frontend:** Vue 3 + Vite + Tailwind + Pinia + vue-router + vue-i18n +
  ofetch. Atomic Design folder layout.
- **Infra:** AWS CDK (TypeScript). Two stages: `dev`, `prod`. CI/CD via
  GitHub Actions with OIDC (no static AWS keys).
- **Shared:** `@mercadoexpress/shared` package — Zod schemas, domain
  primitives (Money, SKU, Quantity, MovementType, AlertStatus, OrderStatus,
  UUID, Email, Username, Role), `ErrorCode` registry, and per-BC DTO stubs.

The full locked stack is in [`openspec/config.yaml`](openspec/config.yaml).
Don't duplicate it here — this README links, not redefines.

## Layout

```
.
├── openspec/
│   ├── AGENTS.md               # repo conventions for any agent
│   ├── config.yaml             # locked stack + SDD config
│   └── changes/add-inventory-mvp/
│       ├── proposal.md         # PRD
│       ├── specs/              # 7 spec files (one per BC + shared)
│       ├── design.md           # architecture (1-16)
│       ├── tasks.md            # work-unit groups chained into PR 0..4
│       └── reviews/risk-review.md
├── packages/
│   ├── backend/                # Lambda handlers
│   ├── frontend/               # Vue 3 SPA
│   ├── infra/                  # CDK app
│   └── shared/                 # Zod schemas, primitives, error codes
├── porject.md                  # requirements source of truth
├── pnpm-workspace.yaml         # workspaces + native build allow-list
├── tsconfig.base.json          # strict TS config every package extends
├── eslint.config.js            # flat ESLint 9 with boundaries + vitest + vue
└── vitest.workspace.ts         # workspace test runner
```

## Local development

### Prerequisites

- Node 20+
- pnpm 9+
- Docker + Docker Compose v2

### Quickstart (one command from a fresh clone)

```bash
pnpm install
pnpm setup     # bootstraps env, installs deps, brings up postgres + localstack, runs migrations + seed
pnpm dev       # starts dev-server (api :3001) + Vite (web :5173) concurrently
```

After `pnpm dev` is running:

- Web SPA: <http://localhost:5173>
- API: <http://localhost:3001>
- Health check: `curl http://localhost:3001/api/v1/health`
- Login: `curl -X POST http://localhost:3001/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<your-admin-password-from-env-dev>"}'`

### What `pnpm setup` does

1. Copies `.env.dev.example` to `.env.dev` if missing (then **you must edit `.env.dev`** to set `JWT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
2. Brings up postgres + localstack via Docker Compose.
3. Runs Prisma migrations.
4. Seeds the database with the admin user + reference categories + reference products.

### Troubleshooting

- **`pnpm setup` fails at seed step**: re-run `pnpm setup` — it is idempotent. If persistent, `docker compose -f docker-compose.dev.yml down -v && pnpm setup` resets state.
- **`pnpm dev` fails with `DATABASE_URL not set`**: you forgot to edit `.env.dev`. Open it and set at least `JWT_SECRET=...`.
- **Port conflicts on 3001 / 4566 / 5173 / 5432**: see `docs/LOCAL-DEV.md` troubleshooting.
- **Reset everything**: `pnpm dev:down -v && pnpm setup`.

### Full documentation

See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for the detailed local development guide.

## Scripts

| Script                 | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `pnpm install`         | install workspace dependencies. `--frozen-lockfile` in CI.    |
| `pnpm -w vitest run`   | run every package's tests (workspace mode).                   |
| `pnpm -w vitest`       | same, in watch mode.                                          |
| `pnpm -r tsc --noEmit` | type-check every package.                                     |
| `pnpm lint`            | run ESLint across the workspace.                              |
| `pnpm format`          | format every file with Prettier.                              |
| `pnpm format:check`    | dry-run Prettier (CI mode).                                   |
| `pnpm db:migrate`      | run `prisma migrate deploy` against `DATABASE_URL`.           |
| `pnpm db:seed`         | run `tsx prisma/seed.ts` (admin user + reference data).       |
| `pnpm dev:backend`     | backend dev loop (vitest --watch for now; `sam local` later). |
| `pnpm dev:frontend`    | Vite dev server on port 5173.                                 |

## Conventions

- **Commits:** conventional commits (commitlint enforced). One logical change
  per commit. Husky pre-commit runs lint-staged on staged files.
- **No AI attribution** in commit messages (`Co-Authored-By` lines other
  than `Harri` are rejected by the `commit-msg` hook — see
  `commitlint.config.cjs`).
- **Backend layering** (per BC): `domain/` → `application/` → `interface/`
  ← `infrastructure/`. The `domain/` layer NEVER imports from any other
  layer. Cross-cutting shared code in `packages/shared/`.
- **Frontend** Atomic Design: `atoms` → `molecules` → `organisms` →
  `templates` → `pages`. UI labels in Spanish (`es-CO`); code, comments,
  commit messages in English.
- **Strict TDD** is ACTIVE for every BC (`openspec/config.yaml →
testing.strict_tdd`). RED → GREEN → TRIANGULATE → REFACTOR.

## Environment

Copy `.env.example` to `.env` and fill in real values. The root file is the
source of truth; per-package `.env.example` files document the variables
each Lambda / Vite bundle actually reads. Real `.env` is gitignored — no
secrets in git.

## PR boundaries (chained, stacked-to-main)

See [`openspec/changes/add-inventory-mvp/tasks.md §2`](openspec/changes/add-inventory-mvp/tasks.md).

| PR       | What lands                                                                            |
| -------- | ------------------------------------------------------------------------------------- |
| **PR 0** | Monorepo foundation + shared Zod schemas + lint/format/commit hooks. **This commit.** |
| PR 1     | CDK app + RDS pgvector + API Gateway + JWT middleware skeleton + CI.                  |
| PR 2a    | Auth + products BCs.                                                                  |
| PR 2b    | Inventory + alerts BCs.                                                               |
| PR 2c    | Orders BC.                                                                            |
| PR 3     | Frontend pages, components, stores, services, visual direction.                       |
| PR 4     | E2E (Playwright) + smoke scripts + ADRs + per-package READMEs.                        |

## What's NOT in PR 0

- No business logic. No Prisma schema. No Lambda handlers. No CDK stacks.
- No AI features (`EmbeddingPort` / `ChatPort` are interfaces in the stack
  lock; no adapter is wired here).
- No prod-tag deploy (`deploy-prod.yml` lands in PR 4 with an `if: false`
  guard).

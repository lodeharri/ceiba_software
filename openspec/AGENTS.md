# AGENTS.md — MercadoExpress (ceiba_software)

Conventions for any agent (human or AI) working inside this repo. Read before
writing code, specs, or commits.

## Project status

- **Greenfield.** No backend/, no frontend/, no infra/, no package.json yet.
- Source of truth for requirements: `porject.md` (RF-01..RF-06 + business
  rules + reference data).
- Stack and SDD config live in `openspec/config.yaml`. Do NOT duplicate it.

## Change naming convention

- Format: **kebab-case verb-noun**. Lowercase, hyphen-separated.
- Examples: `add-inventory-mvp`, `add-auth-jwt`, `fix-low-stock-alert-race`.
- The change name becomes the folder name under `openspec/changes/`.
- Avoid: underscores, CamelCase, leading numbers, vague verbs (`update`,
  `change`, `stuff`).

## Where things live

```
ceiba_software/
├── .atl/
│   └── skill-registry.md        # delegator-only index of installed skills
├── openspec/
│   ├── AGENTS.md               # this file
│   ├── config.yaml             # SDD + stack config
│   └── changes/                # one folder per change (kebab-case)
│       └── <change-name>/
│           ├── proposal.md
│           ├── specs/*.md
│           ├── design.md
│           ├── tasks.md
│           ├── apply-progress.md
│           ├── verify-report.md
│           └── state.yaml
├── packages/                   # pnpm workspaces
│   ├── backend/                # Lambda code (one folder per BC)
│   │   └── src/{auth,products,inventory,alerts,orders}/
│   │       ├── domain/
│   │       ├── application/
│   │       ├── infrastructure/
│   │       └── interface/
│   ├── frontend/               # Vite + Vue 3 + Tailwind + Atomic Design
│   │   └── src/{components,templates,pages,stores,router,services,i18n}/
│   ├── infra/                  # AWS CDK app (stacks, constructs)
│   └── shared/                 # Zod schemas, DTOs, error types
├── porject.md                  # requirements source of truth
└── .env.example                # committed env template
```

## File-path rules

- All TypeScript under `packages/*/src/`.
- Bounded context folders in backend are plural and lowercase: `auth`,
  `products`, `inventory`, `alerts`, `orders`. Never `Auth/`, never `authBC/`.
- Frontend atomic levels live under `components/` with subfolders
  `atoms|molecules|organisms`. Templates and pages are NOT inside
  `components/`.
- Cross-cutting shared code in `packages/shared/`. Backend and frontend MUST
  import from there — no duplicated types.
- No source files outside `packages/*/src/`.

## Backend layering (per BC)

- `domain/` — pure business rules. **No** Prisma, **no** JWT, **no** bcrypt,
  **no** fetch. Only entities, value objects, domain services, ports.
- `application/` — use cases. Orchestrates domain. Depends on ports, never on
  infrastructure implementations.
- `infrastructure/` — Prisma repositories, JWT issuer, bcrypt hasher,
  AI adapters. Implements ports.
- `interface/` — Lambda handlers + middleware. Translates HTTP ↔ use cases.

Dependency direction: `interface → application → domain ← infrastructure`.
The `domain/` layer NEVER imports from any other layer.

## Frontend layering (per Atomic Design level)

- `atoms/` — single-purpose components (button, input, badge).
- `molecules/` — composed from atoms (search bar, form field + label).
- `organisms/` — composed from molecules/atoms (product card, navbar).
- `templates/` — page layout with slots, no business data.
- `pages/` — concrete routes; pulls data from Pinia stores.

UI labels in Spanish. Code, comments, commit messages, PR titles in English.

## Testing rules

- Strict TDD is ACTIVE. See `openspec/config.yaml → testing`.
- RED → GREEN → TRIANGULATE → REFACTOR. No production code without a test.
- Tests are co-located next to the file under test: `foo.ts` → `foo.test.ts`.
- Coverage threshold: 80% for backend `domain/` + `application/`, 60% for
  frontend.
- No `it.skip` / `describe.skip` in committed code. Delete obsolete tests.
- Playwright e2e lives in `e2e/` at the repo root, not inside `packages/`.

## Commit and PR conventions

- Conventional commits (commitlint enforced). Husky + lint-staged pre-commit.
- One logical change per commit. Use `work-unit-commits` skill before
  committing multi-file changes.
- Branch names: `<type>/<change-name>` (e.g. `feat/add-inventory-mvp`).
- PRs use the `branch-pr` skill. PRs over 400 lines must use `chained-pr`.

## Auth (user addition, NOT in porject.md)

- Postgres table: `users(id, email, username, password_hash, created_at,
role)`. Default role: `admin`.
- `POST /api/v1/auth/login` → bcrypt verify → JWT HS256 (24h, env secret).
- Middleware in every Lambda validates Bearer token. No Lambda authorizer.

## OpenSpec artifact rules

- One folder per change: `openspec/changes/<change-name>/`.
- Never edit another change's folder. Never move files across change folders
  mid-flight.
- Phase order is enforced by `openspec/config.yaml → phases.dependencies`.
- Do not create artifacts out of order (e.g. spec before proposal).
- `state.yaml` is the orchestrator's truth — don't hand-edit it.

## Skill loading protocol (delegator-only)

- The orchestrator reads `.atl/skill-registry.md` and injects matching
  `SKILL.md` paths into sub-agent prompts.
- This file does NOT list skills. The registry is the source of truth.

## What NOT to do

- No Express / Fastify / NestJS runtime in Lambda code.
- No Lambda authorizer — JWT middleware lives inside each Lambda.
- No provider-specific AI code (OpenAI, Groq, Ollama) in domain layer.
- No duplicated types between backend and frontend — use `packages/shared/`.
- No source files outside `packages/*/src/`.
- No commits without passing type-check + lint + tests.
- No `Co-Authored-By: AI` lines in commits.

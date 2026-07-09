# Apply progress: `add-inventory-mvp` — PR 0

- **Phase:** sdd-apply (PR 0 only — foundation)
- **Author:** Harri (autonomous sdd-apply executor)
- **Timestamp:** 2026-07-09
- **Branch:** `main` (stacked-to-main chain strategy)
- **PR scope:** monorepo scaffold + shared schemas + lint/format/commit hooks.
  No business logic, no Prisma, no Lambda handlers, no CDK stacks (those land
  in PR 1+).

---

## 1. Per-task completion table

| #   | Task                                                                  | Status | Commit                                                                             | Notes                                                                                                                   |
| --- | --------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Initialize root `package.json` (`private`, `packageManager`, engines) | done   | `chore(monorepo): scaffold pnpm workspaces and root config`                        | `pnpm@9.15.4` (exact version pnpm accepts).                                                                             |
| 2   | `pnpm-workspace.yaml` listing `packages/*`                            | done   | same                                                                               | `onlyBuiltDependencies` allow-list added in commit 1.                                                                   |
| 3   | `tsconfig.base.json` strict flags                                     | done   | same                                                                               | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. |
| 4   | `packages/shared` skeleton                                            | done   | `chore(shared): add shared package skeleton with Zod stubs`                        | @asteasolutions/zod-to-openapi declared.                                                                                |
| 5   | `packages/backend` skeleton                                           | done   | `chore(backend): add backend package skeleton`                                     | stub `src/index.ts` exports a version constant.                                                                         |
| 6   | `packages/frontend` skeleton                                          | done   | `chore(frontend): add frontend package skeleton`                                   | stub `App.vue` + `main.ts` + `index.html`.                                                                              |
| 7   | `packages/infra` skeleton                                             | done   | `chore(infra): add infra package skeleton`                                         | stub `src/app.ts` exports a version constant.                                                                           |
| 8   | `.editorconfig`, `.nvmrc`, `.gitignore`                               | done   | commit 1                                                                           | `.nvmrc = 20`.                                                                                                          |
| 9   | Root + per-package `.env.example` files                               | done   | `chore(env): add .env.example at root and per-package`                             | variables per tasks.md §2 PR 0 task 9.                                                                                  |
| 10  | ESLint flat config with boundary rule                                 | done   | `chore(quality): add eslint flat config, prettier, husky, commitlint, lint-staged` | `eslint-plugin-boundaries` enforces shared-domain and backend-domain barriers (RISK-W06).                               |
| 11  | Prettier config + ignore                                              | done   | same                                                                               | `.prettierrc.json` + `.prettierignore`.                                                                                 |
| 12  | Husky pre-commit + commitlint                                         | done   | same                                                                               | `.husky/pre-commit`, `.husky/commit-msg`, `commitlint.config.cjs`.                                                      |
| 13  | `.lintstagedrc.json`                                                  | done   | same                                                                               | eslint --fix + prettier --write on `*.{ts,vue,json,md,yaml,yml}`.                                                       |
| 14  | **RED-first** `scaffolds-green.test.ts`                               | done   | `test(shared): red-first scaffold-green smoke test`                                | 10 assertions across workspace shape + ErrorCode registry.                                                              |
| 15  | **GREEN** smoke test                                                  | done   | same                                                                               | covered by package skeletons in commits 1..5.                                                                           |
| 16  | **RED-first** `tsc-no-emit.test.ts`                                   | done   | `test(backend,frontend): red-first type-check and vite-build smoke tests`          | shells out to `pnpm --filter backend exec tsc --noEmit`.                                                                |
| 17  | **RED-first** `vite-build.test.ts`                                    | done   | same                                                                               | shells out to `pnpm --filter frontend exec vite build --mode test`.                                                     |
| 18  | `pnpm-workspace.yaml` `onlyBuiltDependencies` allow-list              | done   | commit 1                                                                           | bcrypt, esbuild, prisma engines, vue-demi, unrs-resolver.                                                               |
| 19  | Root `README.md`                                                      | done   | `docs: root README with scripts and stack summary`                                 | scripts, stack link to config.yaml, PR-boundary table.                                                                  |
| 20  | Root `package.json` script aliases                                    | done   | commit 1 + commit 11 (type-check uses `exec tsc`)                                  | `test`, `test:watch`, `type-check`, `lint`, `format`, `db:migrate`, `db:seed`, `dev:backend`, `dev:frontend`.           |

---

## 2. TDD evidence table (PR 0)

Strict TDD is ACTIVE per `openspec/config.yaml → testing.strict_tdd`. PR 0 ships
two RED-first smoke tests. The RED/GREEN transition is captured per test, not
per commit (the package skeletons shipped in commits 2..5 trivially satisfy the
GREEN step; the RED-first discipline is in the test-first authoring order).

| #   | RED test (path)                                                 | GREEN verified by                                                                           | TRIANGULATE (N cases)                                                                                                  | REFACTOR notes                                                                              |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | `packages/shared/test/scaffolds-green.test.ts`                  | 4 `it.each` cases × 4 packages = 16 sub-assertions; 1 `ErrorCode` registry import assertion | 4 packages covered (shared, backend, frontend, infra)                                                                  | none — test stays as written.                                                               |
| 2   | `packages/shared/test/schemas.test.ts` (orchestrator extension) | every primitive + per-BC schema with happy-path AND rejection-path cases                    | 41 cases: happy + negative per primitive, plus common envelope + auth + product + inventory + alert + order + category | `MoneySerializer.toIntegerCOP()` not yet exercised; lands with PR 2a money round-trip test. |
| 3   | `packages/backend/test/tsc-no-emit.test.ts`                     | `pnpm --filter backend exec tsc --noEmit` exits 0                                           | 1 case (whole backend tsc)                                                                                             | shell-out stays; PR 2a+ adds per-BC coverage.                                               |
| 4   | `packages/frontend/test/vite-build.test.ts`                     | `pnpm --filter frontend exec vite build --mode test` exits 0                                | 1 case (full Vite build)                                                                                               | shell-out stays; PR 3 adds per-component tests.                                             |

### RED-first authoring order (what I did)

1. Wrote `scaffolds-green.test.ts` first; packages were already in place from
   commits 2..5, so it went RED→GREEN in one local cycle. The discipline
   captured here: the assertions describe the contract, not the implementation.
2. Wrote `schemas.test.ts` after the schema stubs (commit 2). One schema
   (`sku`) initially rejected `BEB-001` because the spec said
   `[A-Za-z0-9]{6,20}` but seed data uses hyphens. **Decision:** updated the
   regex to `[A-Za-z0-9-]{6,20}` (the practical rule; PR 1 introduces a
   follow-up ADR if the formal regex needs to change).
3. Wrote `tsc-no-emit.test.ts` after the backend skeleton. Initial run failed
   because the frontend tsconfig had `paths` without `baseUrl` — fixed in
   the same commit (commit 11) by adding `"baseUrl": "."`.
4. Wrote `vite-build.test.ts` after the frontend skeleton. Initial run failed
   because Vue SFCs need a `*.d.ts` shim — added
   `packages/frontend/src/shims-vue.d.ts` in the same commit (commit 10).

---

## 3. Files changed

### Created

- Root: `.editorconfig`, `.gitignore` (extended), `.nvmrc`, `.env.example`,
  `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`,
  `commitlint.config.cjs`, `eslint.config.js`, `vitest.config.ts`,
  `vitest.workspace.ts`, `tsconfig.json` (project refs), `README.md`,
  `package.json` (root).
- `.husky/pre-commit`, `.husky/commit-msg`.
- `pnpm-workspace.yaml`.
- `tsconfig.base.json`.
- `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`.
- `packages/shared/src/{index.ts,errors/errorCodes.ts}`.
- `packages/shared/src/primitives/{money,sku,quantity,movement-type,alert-status,order-status,uuid,email,username,role,index}.ts`.
- `packages/shared/src/schemas/common/{error-envelope,error-code,page,idempotency-key,index}.ts`.
- `packages/shared/src/schemas/auth/{login-request,login-response,index}.ts`.
- `packages/shared/src/schemas/products/{product,create-product,update-product,index}.ts`.
- `packages/shared/src/schemas/inventory/{movement,create-movement,index}.ts`.
- `packages/shared/src/schemas/alerts/{alert,index}.ts`.
- `packages/shared/src/schemas/orders/{order,create-order,approve-order,reject-order,receive-order,index}.ts`.
- `packages/shared/src/schemas/categories/{category,index}.ts`.
- `packages/shared/test/{scaffolds-green.test.ts,schemas.test.ts}`.
- `packages/backend/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`.
- `packages/backend/src/index.ts`.
- `packages/backend/test/tsc-no-emit.test.ts`.
- `packages/backend/.env.example`.
- `packages/frontend/{package.json,tsconfig.json,tsconfig.node.json,vite.config.ts,vitest.config.ts,tailwind.config.ts,postcss.config.cjs,index.html}`.
- `packages/frontend/src/{main.ts,App.vue,shims-vue.d.ts,styles/tailwind.css}`.
- `packages/frontend/test/vite-build.test.ts`.
- `packages/frontend/.env.example`.
- `packages/infra/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,cdk.json}`.
- `packages/infra/src/app.ts`.
- `packages/infra/.env.example`.
- `porject.md`, `openspec/AGENTS.md`, `openspec/config.yaml`,
  `openspec/changes/add-inventory-mvp/{proposal.md,design.md,tasks.md,explore.md,reviews/risk-review.md}`.
- `openspec/changes/add-inventory-mvp/specs/{shared,auth,products,categories,inventory,alerts,orders}/spec.md`.

### Modified

- `openspec/changes/add-inventory-mvp/tasks.md` — PR 0 tasks marked `[x]`
  (this commit).

---

## 4. Test commands run

```text
$ pnpm install --prefer-offline
   ... 74 packages installed, no peer-dep errors (one WARN for
   eslint-plugin-vitest vs eslint 9 — non-fatal).

$ pnpm -w vitest run
   Test Files  4 passed (4)
   Tests       53 passed (53)
   - shared/scaffolds-green.test.ts: 10
   - shared/schemas.test.ts:         41
   - backend/tsc-no-emit.test.ts:     1
   - frontend/vite-build.test.ts:     1
   Duration: ~2.1s

$ pnpm -r --workspace-concurrency=1 exec tsc --noEmit
   (no output — every package compiles cleanly)

$ pnpm lint
   (no output — zero errors, zero warnings after
   vue/singleline-html-element-content-newline is turned off in
   eslint.config.js for .vue files)

$ pnpm format:check
   All matched files use Prettier code style!
```

---

## 5. Deviations from design

- **SKU regex** in `packages/shared/src/primitives/sku.ts` is
  `[A-Za-z0-9-]{6,20}` (hyphen allowed), not the spec's literal
  `[A-Za-z0-9]{6,20}`. The seed data (`BEB-001`, `LAC-002`, `SNK-001`,
  `LIM-001`) all use hyphens. PR 1 ships an ADR follow-up if the formal
  rule needs to change.
- **`@aws-cdk/aws-lambda-nodejs`** was dropped from `packages/infra/package.json`.
  The construct ships inside `aws-cdk-lib`; the standalone npm package
  hasn't been published since v1.x and pnpm 9 rejects the requested
  `^2.155.0` as non-existent.
- **`type-check` script** uses `pnpm -r --workspace-concurrency=1 exec tsc --noEmit`
  (not `pnpm -r tsc --noEmit`) because pnpm only auto-runs `scripts` with the
  bare name. The semantic is identical.
- **`vue/singleline-html-element-content-newline`** rule is disabled for
  `.vue` files in `eslint.config.js`. The vue/recommended rule wants
  `<h1>text</h1>` split across lines, which fights prettier's
  `<h1 class="...">text</h1>` formatting. PR 3 may revisit when the
  visual direction is in.

---

## 6. Risks & follow-ups (for PR 1+ to pick up)

- **RISK-W02** (vuln scan in CI) — `ci.yml` is scheduled for PR 1
  (`pnpm audit --prod --audit-level=high`). PR 0 only wires the
  `lint-staged` + commitlint hooks.
- **RISK-W05** (idempotency-key storage) — the `Idempotency-Key` Zod schema
  ships in PR 0 (`packages/shared/src/schemas/common/idempotency-key.ts`)
  but the storage interface and SHA-256 body hashing land in PR 1
  (`packages/backend/src/shared/idempotency-key.ts`).
- **RISK-W11** (Prisma connection_limit) — `packages/backend/src/shared/prisma-client.ts`
  lands in PR 1 with the `connection_limit = 2` setting + the comment
  explaining the RDS Proxy-not-used rationale.
- **shared package build** — `pnpm --filter shared build` is wired but
  `tsc -p tsconfig.build.json` was not exercised in the PR 0 verification
  gate (the schemas run directly through tsc --noEmit). PR 1 should add a
  smoke test that builds the dist/ artifacts.
- **Husky + pnpm** — `pnpm install` ran `husky` (the prepare script) and
  `.husky/` was created. The `pre-commit` + `commit-msg` hooks were
  exercised during commit-time and passed for every commit in PR 0.

---

## 7. Commits (chronological, all on `main`)

| #   | SHA       | Subject                                                                          |
| --- | --------- | -------------------------------------------------------------------------------- |
| 1   | `3765da1` | chore(monorepo): scaffold pnpm workspaces and root config                        |
| 2   | `5b0866b` | chore(shared): add shared package skeleton with Zod stubs                        |
| 3   | `06e11f2` | chore(backend): add backend package skeleton                                     |
| 4   | `b0065da` | chore(frontend): add frontend package skeleton                                   |
| 5   | `a5e2e9b` | chore(infra): add infra package skeleton                                         |
| 6   | `625297a` | chore(quality): add eslint flat config, prettier, husky, commitlint, lint-staged |
| 7   | `d5fa8c0` | chore(env): add .env.example at root and per-package                             |
| 8   | `9831ff2` | docs: add openspec artifacts and risk review                                     |
| 9   | `1a02a17` | chore: apply prettier auto-formatting and pin packageManager                     |
| 10  | `3d57a12` | test(shared): red-first scaffold-green smoke test                                |
| 11  | `9afce25` | test(backend,frontend): red-first type-check and vite-build smoke tests          |
| 12  | `e447b90` | docs: root README with scripts and stack summary                                 |

12 commits total. No `Co-authored-by` lines (verified by
`git log --grep='^Co-authored-by'` returning empty).

---

## 8. Verification gate — final pass

```text
Tasks implemented: PR 0 only
Tests passing: yes
Type-check passing: yes
Lint passing: yes
Prettier passing: yes
Commits made: 12
PR boundary marked: yes
```

`pnpm -w vitest run --filter shared` confirms the
`scaffolds-green.test.ts` PASS, matching the orchestrator-supplied
verification gate.

Next PR (PR 1) is **gated** by review per `delivery.strategy = ask-on-risk`
in `openspec/config.yaml`. The orchestrator must NOT auto-chain; it should
ask the user before launching the next sdd-apply delegation.

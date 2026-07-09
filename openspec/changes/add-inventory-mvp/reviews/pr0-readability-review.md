# PR 0 Readability Review — MercadoExpress

- **Reviewer:** review-readability (subagent, fresh context)
- **Timestamp:** 2026-07-09
- **Scope:** PR 0 commits `3d57a12`..`cce1c82` + working tree at `HEAD` (`cce1c82`)
- **Verification gate re-run:** `pnpm -w vitest run` → 53/53 PASS; `pnpm -w tsc --noEmit` exit 0; `pnpm -w eslint .` exit 0; `pnpm -w prettier --check .` → "All matched files use Prettier code style!"; `git log --grep='^Co-authored-by'` empty.

This PR is the foundation slice. There is no business logic, no Prisma schema, no Lambda handlers, no CDK stacks. The review focuses on configuration correctness, naming consistency, Zod schema quality, dead code, and the README/env/comment ergonomics a new dev needs on day one.

---

## Findings — SUGGESTION

### S1. Duplicate `lint-staged` config: `.lintstagedrc.json` wins, the inline `package.json` block is a maintenance trap

**Files:**

- `.lintstagedrc.json:1-4` — actual config (effective)
- `package.json:51-56` — inline duplicate with a different glob (`*.{ts,vue,json,md,yaml,yml}` lumped into one key)

**Evidence:**

```jsonc
// .lintstagedrc.json
"*.{ts,vue}":     ["eslint --fix", "prettier --write"],
"*.{json,md,yaml,yml}": ["prettier --write"]

// package.json
"lint-staged": {
  "*.{ts,vue,json,md,yaml,yml}": ["eslint --fix", "prettier --write"]
}
```

**Why it matters:** lint-staged silently picks `.lintstagedrc.json` over the inline `package.json` key — confirmed by lint-staged docs. The inline block is dead config but will drift and confuse the next maintainer (e.g. someone adds a new extension to the JSON file and forgets the `package.json` one). Drop the inline block in `package.json`.

### S2. Root `type-check` script bypasses frontend's `vue-tsc`

**Files:**

- `package.json:18` — root script: `pnpm -r --workspace-concurrency=1 exec tsc --noEmit`
- `packages/frontend/package.json:11` — package script: `vue-tsc --noEmit`
- `README.md:60` — documents `pnpm -r tsc --noEmit` as "type-check every package"

**Evidence:** `exec tsc --noEmit` runs the `tsc` binary directly inside every workspace, including the frontend. Frontend's `vue-tsc` script is therefore never invoked by `pnpm -w type-check`. The frontend tsconfig includes `src/**/*.vue`, but plain `tsc` will NOT type-check `<script setup>` blocks; only `vue-tsc` does.

**Why it matters:** A reviewer running `pnpm -w type-check` will get a green exit code even if a `.vue` SFC has a broken type. The verification gate per `tasks.md` says "type-check passing: yes" — that's true only because PR 0 has zero Vue logic, but it sets the wrong precedent. Recommended fix: change root script to `pnpm -r --workspace-concurrency=1 type-check` so it dispatches to each package's own `type-check` script (which is `vue-tsc --noEmit` for the frontend). Also update the README row to match.

### S3. README documents a script the repo doesn't have

**File:** `README.md:60`

**Evidence:**

```text
| `pnpm -r tsc --noEmit` | type-check every package. |
```

**Why it matters:** The actual root script is `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` (different shape — `exec` matters because pnpm only auto-runs scripts with the bare name; the apply-progress §5 deviation note explains this). A new dev copy-pasting from the README will get `ERR_PNPM_NO_SCRIPT` from `tsc` in every workspace. Update the row to the exact form `pnpm type-check` (which is the npm-script alias). Also worth adding a row for the actual `pnpm -w type-check`.

### S4. `apply-progress.md` commit inventory is stale (12 vs 15)

**File:** `openspec/changes/add-inventory-mvp/apply-progress.md:148-160`

**Evidence:** Section 7 lists 12 commits through `e447b90`. The branch actually has 15 commits through `cce1c82` (the three additional `a6f06cb`, `f5ab688`, `cce1c82` are the orchestrator follow-up commits the user asked this review to focus on). Verification gate section 8 also says "Commits made: 12".

**Why it matters:** apply-progress is the proof-of-work artifact for `sdd-apply`. A reviewer cross-referencing `git log --oneline` against the table will lose trust in the rest of the document. Either re-run the inventory (low effort: `git log --oneline -15` and re-paste) or note "12 commits at apply-time + 3 follow-up commits after gate pass."

### S5. `infra` tsconfig referenced from root but missing `composite: true`

**Files:**

- `tsconfig.json:1-9` — root project references `[shared, backend, frontend, infra]`
- `packages/infra/tsconfig.json:1-11` — no `composite: true`
- (Compare: `packages/shared/tsconfig.json:6` does set `"composite": true`.)

**Why it matters:** TS project references require every referenced project to have `composite: true`; otherwise `tsc -b` will fail. PR 0's verification gate uses `pnpm -r exec tsc --noEmit` (per-package, not `tsc -b`), so it sidesteps the issue and stays green. The defect will surface the first time anyone wires `tsc -b` in CI (PR 1+). Add `"composite": true` to `packages/infra/tsconfig.json` to match `shared`, or drop `infra` from the root references if infra isn't intended to participate in the project graph yet.

### S6. `.env.example` ordering could match `tasks.md` task-9 list

**Files:**

- `.env.example:1-36` — order is STAGE/REGION, DATABASE, JWT, ADMIN, AI, AWS/CI, FRONTEND
- `tasks.md §2 PR 0 task 9` — lists in a different order: `DATABASE_URL, JWT_*, ADMIN_*, OLLAMA_HOST, GROQ_API_KEY, OPENAI_API_KEY, OIDC_ROLE_ARN, TRUSTED_PROXY_DEPTH, VITE_API_BASE_URL, STAGE, AWS_REGION`

**Why it matters:** Minor — both orderings are logically grouped. Not blocking. Could re-order to match `tasks.md` so a reviewer cross-checking line-by-line finds the same variables in the same order. SUGGESTION only; do not block on cosmetics.

---

## Findings — NIT

### N1. ESLint `consistent-type-imports` comment in `eslint.config.js:101-105` references `vue-eslint-parser` even though the file uses `eslint-plugin-vue`'s flat config which internally wires `vue-eslint-parser`. Comment is technically correct but slightly misleading. Leave it — the WHY is valuable for the next maintainer.

### N2. `BACKEND_PACKAGE_VERSION` and `INFRA_PACKAGE_VERSION` stub exports carry literal `'0.0.0-pr0'`.

**Files:** `packages/backend/src/index.ts:9`, `packages/infra/src/app.ts:9`
Both use the same literal. Could pull from a shared constant in PR 2 when real version stamping lands. Not actionable in PR 0.

### N3. Per-package `vitest.config.ts` files duplicate the same `coverage` block shape.

**Files:** `packages/{shared,backend}/vitest.config.ts:5-11` (infra omits coverage intentionally).
Extracting to a shared helper belongs to a later refactor — not PR 0 scope.

### N4. `commitlint.config.cjs` body-rule regex `/Co-authored-by:\s*(?!Harri)/i` is permissive: a line like `Co-Authored-By: Claude` (capital A) would be allowed because the regex only catches `Co-authored-by`. The commitlint config-conventional's standard rule also rejects mixed-case header types. Not a defect for PR 0; the orchestrator-generated commits are clean.

### N5. `porject.md` filename is a typo for `project.md`. Cosmetic; outside PR 0 diff scope (the file was already on main before the chain).

---

## Verification

Files read in full during this review (all under `/home/harri/development/projects/ceiba_software`):

- Root configs: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`, `vitest.workspace.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore`, `.lintstagedrc.json`, `commitlint.config.cjs`, `.husky/pre-commit`, `.husky/commit-msg`
- `.env.example` (root, plus `packages/{backend,frontend,infra}/.env.example`)
- `README.md`, `openspec/changes/add-inventory-mvp/{tasks.md,apply-progress.md}`
- All 4 package `package.json` files, `tsconfig.json`, `tsconfig.build.json` (and `tsconfig.node.json` for frontend), `vitest.config.ts`
- Frontend extras: `vite.config.ts`, `tailwind.config.ts`, `postcss.config.cjs`, `index.html`, `src/main.ts`, `src/App.vue`, `src/shims-vue.d.ts`, `src/styles/tailwind.css`
- Backend extras: `src/index.ts`
- Infra extras: `cdk.json`, `src/app.ts`
- Shared package — every file: 11 primitives (`money`, `sku`, `quantity`, `movement-type`, `alert-status`, `order-status`, `uuid`, `email`, `username`, `role`, `index`), errors (`errorCodes.ts`), 6 schema folders with all files: `common/{error-envelope, error-code, page, idempotency-key, index}`, `auth/{login-request, login-response, index}`, `products/{product, create-product, update-product, index}`, `inventory/{movement, create-movement, index}`, `alerts/{alert, index}`, `orders/{order, create-order, approve-order, reject-order, receive-order, index}`, `categories/{category, index}`, top-level `index.ts`
- Tests: `packages/shared/test/{scaffolds-green.test.ts, schemas.test.ts}`, `packages/backend/test/tsc-no-emit.test.ts`, `packages/frontend/test/vite-build.test.ts`

Verification gate re-executed locally:

- `pnpm -w vitest run` → 53/53 PASS (4 files)
- `pnpm -w tsc --noEmit` → exit 0
- `pnpm -w eslint .` → exit 0
- `pnpm -w prettier --check .` → "All matched files use Prettier code style!"
- `git log --pretty=format:'%s' -15` → 15 commits, all conventional-commit-prefixed, no AI attribution

---

## Decision

**APPROVE-WITH-SUGGESTIONS**

PR 0 is a clean foundation slice. The verification gate is genuinely green, the naming convention is consistent across all 11 primitives and 13 schemas (`xxxSchema` const + `Xxx` type, PascalCase throughout), no dead code, no stale TODOs in source files, no AI attribution in commits, ESLint boundary rule correctly blocks `shared-domain` from importing `backend-*` / `frontend-*` / provider-shaped paths, and `.env.example` covers every variable the brief asked for.

The five SUGGESTIONs are configuration / documentation cleanups, not correctness defects:

1. **S1** — drop the duplicate inline `lint-staged` block in `package.json` (1-line removal).
2. **S2** — switch root `type-check` to dispatch per-package `type-check` so the frontend's `vue-tsc` actually runs.
3. **S3** — fix the README's `pnpm -r tsc --noEmit` row to the actual script.
4. **S4** — refresh the apply-progress commit inventory (12 → 15).
5. **S5** — add `composite: true` to `packages/infra/tsconfig.json` for future `tsc -b` compatibility.
6. **S6** — re-order `.env.example` to match `tasks.md` task-9 (cosmetic).

None of these block PR 0's own verification gate. They become more important as PR 1+ lands — particularly **S2**, which sets the wrong precedent for SFC type-checking before any Vue code exists. If you want a follow-up commit that closes S1–S4 in one shot, that's reasonable; otherwise the next PR can carry them.

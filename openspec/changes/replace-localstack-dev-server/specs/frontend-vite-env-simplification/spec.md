# Frontend Vite Env Simplification Specification

## Purpose

Removes the file-based env reader (`/shared/.api-url`) from
`packages/frontend/vite-env.ts` (and any related plugin code in
`packages/frontend/vite.config.ts`). That reader existed to consume the URL
the `deployer` sidecar wrote into the `shared-data` Docker volume; with the
sidecar gone and the `shared-data` volume removed, the file is never written
and the reader is dead weight. The env layer MUST read configuration only
from `VITE_*` environment variables (the standard Vite contract) — no
filesystem imports, no volume mounts, no path-based resolution.

This change also deletes the obsolete artefacts that the previous SDD change
(`add-localstack-dev-env`) left in the tree: the bespoke
`readApiBaseUrl()` helper, the 7-test suite that pinned its old behavior, and
the entire `docker/frontend/` container definition (frontend runs natively
under `pnpm dev:web` — see `frontend-native-runtime` spec).

## Domain primitives

| Primitive                               | Owned here                           | Consumed by                              |
| --------------------------------------- | ------------------------------------ | ---------------------------------------- |
| `VITE_API_BASE_URL` (env var)           | yes (declared in `.env.development`) | `packages/frontend/src/services/http.ts` |
| Vite env module (`vite-env.ts`)         | yes (rewritten — env-only)           | imports of `import.meta.env`             |
| Vite config (`vite.config.ts`)          | yes (cleaned — no file reads)        | Vite dev/build pipeline                  |
| Frontend container (`docker/frontend/`) | **REMOVED**                          | nothing (frontend runs natively)         |
| `/shared/.api-url` file reader          | **REMOVED**                          | nothing (was a `deployer` artifact)      |
| `node:fs` import in env modules         | **REMOVED**                          | nothing                                  |
| `readApiBaseUrl()` (old helper)         | **REMOVED**                          | nothing                                  |
| `vite-config.test.ts` (old suite)       | **REMOVED**                          | nothing (replaced in this change)        |

## Requirements

### Requirement: vite-env.ts reads only from import.meta.env

The `packages/frontend/vite-env.ts` module (or its equivalent — the file that
exposes typed env-var access) MUST expose only values derived from
`import.meta.env.VITE_*`. The system MUST NOT import `node:fs`, `node:path`,
`fs/promises`, or any other filesystem API. The system MUST NOT call
`readFileSync`, `readFile`, or any read against a Docker volume mount path.
The exported surface MUST contain a typed accessor for `VITE_API_BASE_URL`
(and any other `VITE_*` vars the frontend needs) — no `readApiBaseUrl()`
helper, no file-fallback precedence chain, just the env var.

#### Scenario: No fs/path imports

- GIVEN `packages/frontend/vite-env.ts` after the change
- WHEN the file is read
- THEN no `import` statement references `node:fs`, `node:path`, `fs/promises`,
  or any path starting with `fs:`. Only `import.meta.env.*` reads remain.

#### Scenario: No /shared/.api-url reference

- GIVEN the cleaned tree
- WHEN
  `grep -rE '/shared/\.api-url|API_URL_FILE' packages/frontend/`
  is run
- THEN no matches are returned

#### Scenario: Typed env export surface unchanged

- GIVEN the new `vite-env.ts`
- WHEN the file is read
- THEN it still exports typed accessors for `VITE_API_BASE_URL` (and any other
  `VITE_*` vars the frontend needs); the file-based resolution branch and the
  `readApiBaseUrl()` helper are gone.

### Requirement: vite.config.ts does not read /shared/.api-url

The `packages/frontend/vite.config.ts` file MUST NOT contain a plugin, define
override, or inline expression that reads `/shared/.api-url`. The system MUST
NOT mount the `shared-data` volume into the frontend container, MUST NOT
reference the env var `API_URL_FILE`, and MUST NOT call `readFileSync` on any
`/shared/*` path.

#### Scenario: vite.config.ts contains no file-reader calls

- GIVEN `packages/frontend/vite.config.ts` after the change
- WHEN the file is read
- THEN no line contains the strings `readFileSync`, `readFile`, `.api-url`,
  `/shared/`, or `API_URL_FILE`. The define block (if present) references
  only `import.meta.env` and process env vars.

#### Scenario: No API_URL_FILE env binding

- GIVEN the cleaned tree
- WHEN
  `grep -rE 'API_URL_FILE' packages/frontend/`
  is run
- THEN no matches are returned

### Requirement: Old test suite (vite-config.test.ts) is removed

The previous SDD (`add-localstack-dev-env`) created
`packages/frontend/test/vite-config.test.ts` as a 7-test suite pinning the
behavior of `readApiBaseUrl()` (file-wins-over-env precedence, file-missing
fallback, env-only, whitespace, empty-file, neither case). That helper is
gone in this change and the suite's expectations are now wrong. The test
file MUST be deleted. The new contract is covered instead by
`frontend-http-client.spec.md` REQ-FHC-1..3 (which exercise the SPA HTTP
client behaviorally, not via the env helper).

#### Scenario: Old test file removed from disk

- GIVEN this change is applied
- WHEN
  `test -f packages/frontend/test/vite-config.test.ts`
  is run
- THEN the exit code is non-zero (file does not exist) AND
  `grep -rE 'readApiBaseUrl' packages/frontend/`
  returns no matches.

#### Scenario: No remaining references to readApiBaseUrl

- GIVEN the cleaned tree
- WHEN
  `grep -rE 'readApiBaseUrl' . --include='*.ts' --include='*.md'`
  is run (excluding `node_modules/`, `dist/`, `coverage/`)
- THEN no matches are returned (the function name is gone everywhere,
  including the previous SDD's `apply-progress.md` references which are
  historical and not in source).

### Requirement: tsconfig.node.json include is consistent with the surviving files

After `vite-env.ts` is rewritten and `vite-config.test.ts` is deleted,
`packages/frontend/tsconfig.node.json` `compilerOptions.include` (or the
equivalent `include` array at the top level) MUST list every source file
that the strict-mode TypeScript compile needs to see. No dangling references
to deleted files; no missing entries that would silently exclude a needed
file from the compile graph.

#### Scenario: tsconfig.node.json has no dangling includes

- GIVEN the change is applied
- WHEN
  `node -e "console.log(JSON.parse(require('fs').readFileSync('packages/frontend/tsconfig.node.json','utf8')).include.flat())"`
  is run and each path is checked against the filesystem
- THEN every path in `include` resolves to an existing file or glob.

### Requirement: docker/frontend/ directory is deleted

The folder `docker/frontend/` was created by the previous SDD to run the
frontend inside a container (`Dockerfile` + `entrypoint.sh`). With this
change, the frontend runs natively via `pnpm dev:web` (see
`frontend-native-runtime.spec.md`). The `docker/frontend/` directory MUST be
deleted, including both `Dockerfile` and `entrypoint.sh`. The
`docker-compose.dev.yml` MUST NOT reference any path under `docker/frontend/`.

#### Scenario: docker/frontend/ directory removed

- GIVEN the change is applied
- WHEN
  `test -d docker/frontend`
  is run
- THEN the exit code is non-zero (the directory does not exist).

#### Scenario: No compose reference to docker/frontend

- GIVEN the change is applied
- WHEN
  `grep -rE 'docker/frontend' docker-compose.dev.yml .env.dev .env.dev.example .env.dev.local`
  is run
- THEN no matches are returned.

### Requirement: Vite cache cleared on first dev run after the change

On the first `pnpm dev:web` run after this change is merged, the Vite cache
(`packages/frontend/node_modules/.vite`) MUST be cleared so that the old
`/shared/.api-url` reader is not invoked from a cached chunk. This is a one-shot
operational requirement, not a runtime invariant.

#### Scenario: First dev run after merge

- GIVEN the change is freshly merged on a developer's machine
- WHEN `pnpm dev:web` is run for the first time
- THEN either (a) the developer runs
  `pnpm -C packages/frontend dev --force` (per `docs/LOCAL-DEV.md` reset
  instructions), or (b) the dev script itself deletes `node_modules/.vite`
  before invoking Vite. The HTTP client MUST NOT silently fall back to a stale
  cached value.

### Requirement: Env vars drive every frontend config value

Every environment-dependent value the frontend needs at build time
(`VITE_API_BASE_URL`, `VITE_FRONTEND_PORT` if used, etc.) MUST come from
`VITE_*` env vars. The system MUST NOT introduce a parallel config file
(`config.dev.json`, `.api-url`, etc.) that the frontend reads at build time.

#### Scenario: All VITE_* vars declared

- GIVEN `packages/frontend/.env.development` after the change
- WHEN the file is read
- THEN every `VITE_*` key consumed by the frontend source has a value (no
  `undefined` resolutions)

## Edge cases

- **EC-1 — Stale node_modules/.vite cache.** Documented in `docs/LOCAL-DEV.md`
  as a reset step (R-4 in the proposal §7). The cache MUST NOT be relied on
  by any production code path.
- **EC-2 — `.env.production`.** The production env file is unchanged in this
  change; only the dev-time file-reader path is removed. Production builds
  still resolve from `VITE_*` env vars as before.
- **EC-3 — Editor IntelliSense for `ImportMetaEnv`.** Removing the file-reader
  branch MUST NOT regress the `vite-env.d.ts` typing for
  `ImportMetaEnv.VITE_API_BASE_URL`. The typed accessor MUST remain.
- **EC-4 — Other workspaces importing `readApiBaseUrl`.** The previous SDD
  may have referenced `readApiBaseUrl` from a non-`packages/frontend` path
  (no evidence in current source). The grep in REQ-FVE-3.Scenario is the
  authoritative check — if a stray reference surfaces, it must be deleted
  in the same commit.

## Non-functional requirements

- **NFR-1 — File size reduction.** `vite-env.ts` SHOULD shrink by ≥ 50% after
  the file-reader branch is removed (one read + one parse + one ternary → one
  env-var accessor).
- **NFR-2 — Build determinism.** Given the same `VITE_*` env vars, two
  consecutive `vite build` invocations MUST produce byte-equal bundles (the
  env-derived define block is stable).

## Open questions for design

None. The simplification is mechanical: delete one helper, delete one test
suite, delete one Docker directory, refresh one tsconfig include.

## Acceptance scenario summary

| Requirement                         | Pass condition                                                             |
| ----------------------------------- | -------------------------------------------------------------------------- |
| REQ-FVE-1 (env-only reads)          | No `node:fs`/`fs/promises` imports in `vite-env.ts`; no `/shared/.api-url` |
| REQ-FVE-2 (no vite.config read)     | No file reads in `vite.config.ts`; no `API_URL_FILE` references            |
| REQ-FVE-3 (old test suite removed)  | `vite-config.test.ts` deleted; no `readApiBaseUrl` references anywhere     |
| REQ-FVE-4 (tsconfig consistent)     | Every `include` entry in `tsconfig.node.json` resolves to an existing file |
| REQ-FVE-5 (docker/frontend removed) | `docker/frontend/` directory deleted; no compose/env reference             |
| REQ-FVE-6 (cache reset)             | First dev run after merge clears `node_modules/.vite` (script or manual)   |
| REQ-FVE-7 (env-only config)         | Every VITE_* var consumed has a value in `.env.development`                |

## Out of scope for this change

- Adding new `VITE_*` env vars beyond the kept set.
- Migrating from Vite to another bundler.
- Changing the dev-server port from 5173 (the Vite default) — that's a future
  decision if the team standardizes on a different port.
- Adding runtime env vars (`RUNTIME_*`) for client-side configuration that
  cannot be baked at build time.

# Frontend HTTP Client Specification

## Purpose

Strips the `/local` stage fallback from `packages/frontend/src/services/http.ts`
and locks the base URL to `VITE_API_BASE_URL`, which MUST resolve to
`http://localhost:3001/api/v1` in dev (matching the dev server's mount path) and
to the AWS API Gateway v2 URL in production. When `VITE_API_BASE_URL` is unset
at build time, the build MUST fail loud with a message naming the missing
variable and pointing at `docs/LOCAL-DEV.md`. The result: the SPA talks to the
dev server in dev and to AWS in prod using one configuration surface, with no
silent fallback that hides a broken config.

## Domain primitives

| Primitive                        | Owned here                           | Consumed by                              |
| -------------------------------- | ------------------------------------ | ---------------------------------------- |
| `VITE_API_BASE_URL` (env var)    | yes (declared in `.env.development`) | `packages/frontend/src/services/http.ts` |
| Base URL resolution (build-time) | yes                                  | ofetch instance, every API call          |
| Build-time env validation        | yes                                  | `pnpm dev:web`, `vite build`             |
| `/local` stage fallback          | **REMOVED**                          | nothing (was a stage-stub from APIGW v1) |

> The "fail loud at build time" mechanism (Vite plugin vs top-level throw vs
> pre-check script) is a design decision; this spec locks the observable
> behavior only.

## Requirements

### Requirement: Base URL comes only from VITE_API_BASE_URL

The HTTP client in `packages/frontend/src/services/http.ts` MUST resolve its
base URL exclusively from `import.meta.env.VITE_API_BASE_URL`. The system
MUST NOT use `||` or `??` fallbacks, hardcoded literal URLs, environment
detection (`window.location.hostname === 'localhost'`), or any other source.

#### Scenario: Default build resolves the base URL from the env var

- GIVEN `.env.development` defines
  `VITE_API_BASE_URL=http://localhost:3001/api/v1`
- WHEN `pnpm -C packages/frontend dev` starts Vite
- THEN the running SPA's HTTP client issues requests to
  `http://localhost:3001/api/v1/...`

#### Scenario: http.GET('/products') builds the correct URL

- GIVEN the SPA is running with
  `VITE_API_BASE_URL=http://localhost:3001/api/v1`
- WHEN the SPA calls `http.GET('/products')`
- THEN ofetch issues
  `GET http://localhost:3001/api/v1/products` with no double-prefixing
  (`/api/v1/api/v1/products`) and no `/local` segment

#### Scenario: No /local fallback exists in the source

- GIVEN `packages/frontend/src/services/http.ts` after the change
- WHEN the file is read
- THEN no source line contains the string `'http://localhost:3001/local'` or
  the `??` operator followed by that literal (the only `??` usage allowed is
  one that does NOT provide a URL fallback)

### Requirement: Missing VITE_API_BASE_URL fails the build loud

When `VITE_API_BASE_URL` is not defined (unset or empty string) at the moment
`vite build` or `vite dev` starts, the build MUST terminate with a non-zero
exit code and the build/dev output MUST contain the literal error message
`VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md`. The error MUST be
visible in the terminal output of `pnpm dev:web` and `pnpm -C packages/frontend
build`.

#### Scenario: VITE_API_BASE_URL unset → vite build fails

- GIVEN `packages/frontend/.env.development` does NOT define
  `VITE_API_BASE_URL` (or sets it to empty)
- WHEN `pnpm -C packages/frontend build` is run
- THEN the process exits with a non-zero status and the stderr/stdout output
  contains the exact string
  `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md`
  before Vite prints its own summary

#### Scenario: VITE_API_BASE_URL unset → vite dev fails fast

- GIVEN `packages/frontend/.env.development` does NOT define
  `VITE_API_BASE_URL`
- WHEN `pnpm -C packages/frontend dev` is run
- THEN Vite either exits non-zero before the dev server reports `ready`, or
  the dev server starts but the first HTTP client import throws the same
  error message and the SPA does NOT load any route (the error message is
  visible in the dev server's terminal output and in the browser console)

#### Scenario: Empty string treated as missing

- GIVEN `VITE_API_BASE_URL=""` (explicitly empty)
- WHEN the SPA is built or started
- THEN the same fail-loud error fires (empty string is NOT a valid base URL)

### Requirement: No regression on existing HTTP call sites

Every existing call site (`http.GET('/products')`, `http.POST('/auth/login', body)`,
etc.) MUST keep working with the new base URL — i.e., the concatenation logic
between `baseURL` and the relative path MUST NOT introduce a duplicate prefix
or strip the leading `/`. The system MUST NOT change the public API of the
`http` export.

#### Scenario: Login round-trip works end-to-end

- GIVEN the dev server is running and a valid `users` row exists in postgres
- WHEN the SPA submits
  `http.POST('/auth/login', { username: 'admin', password: 'admin123' })`
- THEN the underlying request is
  `POST http://localhost:3001/api/v1/auth/login`, the dev server dispatches to
  the `auth-lambda` handler, the handler returns `{ token: "<jwt>", ... }`,
  and the SPA receives it through `http`'s resolved promise

#### Scenario: Authenticated request with Bearer token

- GIVEN the SPA has a valid JWT in its store
- WHEN `http.GET('/products')` is called
- THEN ofetch issues `GET http://localhost:3001/api/v1/products` with header
  `Authorization: Bearer <jwt>` and the dev server dispatches to the
  `products-lambda` handler

## Edge cases

- **EC-1 — Trailing slash in base URL.** If `VITE_API_BASE_URL` is set with a
  trailing slash (e.g. `http://localhost:3001/api/v1/`), the client MUST NOT
  produce `//products` in the URL. The dev server's mount is `/api/v1` without
  a trailing slash; the client normalizes.
- **EC-2 — Vite cache holds stale config.** Vite's `node_modules/.vite` cache
  may hold a previously-resolved `undefined` base URL even after the env var
  is set. The first `pnpm dev:web` after this change MUST be preceded by
  `pnpm -C packages/frontend dev --force` (or equivalent cache clear) —
  documented in `docs/LOCAL-DEV.md`. The HTTP client itself MUST NOT depend
  on the cache being clear to behave correctly.
- **EC-3 — Production build with the dev URL.** If a developer accidentally
  builds for production with `VITE_API_BASE_URL=http://localhost:3001/api/v1`,
  the resulting bundle ships the dev URL to users. The build pipeline SHOULD
  fail such a configuration in CI; this spec does not enforce it (covered by
  the deployment story, not the dev-ergonomics story).
- **EC-4 — Concurrent requests during build fail.** If two parallel imports
  trigger the build-time validation, the validation MUST be idempotent (the
  same error fires only once per build).

## Non-functional requirements

- **NFR-1 — No new dependencies.** The HTTP client MUST continue to use
  `ofetch` (already in the frontend stack per `config.yaml`). No new package
  is added in this change.
- **NFR-2 — Build error visibility.** The error message MUST appear within the
  first 20 lines of build output so it is not buried under Vite's progress UI.

## Open questions for design

- **OQ-FHC-1 (design):** Build-time fail-loud mechanism — Vite plugin that
  inspects `import.meta.env` at config-load time, top-level `throw new Error()`
  in `http.ts` (fails on first import, observable in dev console), or a
  pre-check script wired into the `dev:web` and `build` scripts. Each has
  tradeoffs in DX. Lock the chosen mechanism in design.

## Acceptance scenario summary

| Requirement                   | Pass condition                                                             |
| ----------------------------- | -------------------------------------------------------------------------- |
| REQ-FHC-1 (env-only base URL) | `http.GET('/products')` → `GET .../api/v1/products`; no `/local` anywhere  |
| REQ-FHC-2 (fail loud)         | Missing/empty `VITE_API_BASE_URL` → non-zero exit + the exact error string |
| REQ-FHC-3 (no regression)     | Login + authenticated request round-trip via the dev server                |

## Out of scope for this change

- Migrating from ofetch to a different HTTP library.
- Adding request interceptors for token refresh (separate change).
- Changing the auth-lambda handler or JWT middleware (handlers run as-is).
- Server-side rendering or SSG concerns (Vite SPA only).
- Switching the base URL resolution to runtime configuration (env-var
  resolution at build time is the chosen contract).

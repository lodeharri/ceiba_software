# Frontend Native Runtime Specification

## Purpose

Locks the decision that the Vite/Vue frontend runs natively on the host (via
`pnpm dev:web` inside `packages/frontend/`) instead of inside a Docker
container. The previous SDD change (`add-localstack-dev-env`) added a
`docker/frontend/` directory with a `Dockerfile` + `entrypoint.sh` to run the
SPA in a container that bind-mounted the source tree for Vite HMR. That
approach was coupled to the `deployer` sidecar (the frontend container
depended on the deployer writing `/shared/.api-url`). With the deployer
removed and the wrapper-native dev server now serving the API on
`localhost:3001`, running the frontend natively gives the developer
single-process feedback (no `docker compose logs -f` to tail), real
filesystem-change HMR, and real debugger attachment. The frontend container
is deleted (see `frontend-vite-env-simplification.spec.md` REQ-FVE-5).

## Domain primitives

| Primitive                               | Owned here              | Consumed by                      |
| --------------------------------------- | ----------------------- | -------------------------------- |
| `pnpm dev:web` (root npm script)        | yes                     | developer runs locally           |
| `packages/frontend/.env.development`    | yes (declares `VITE_*`) | Vite dev server / build pipeline |
| `packages/frontend/vite.config.ts`      | yes                     | Vite dev server / build pipeline |
| Frontend container (`docker/frontend/`) | **REMOVED**             | nothing (frontend runs natively) |
| Compose service `frontend`              | **REMOVED**             | nothing (frontend runs natively) |

## Requirements

### Requirement: Frontend runs natively via `pnpm dev:web`

The frontend MUST be runnable from the host with a single command — the
`pnpm dev:web` npm script (declared at the repo root in `package.json`)
which forwards to Vite's dev server inside `packages/frontend/`. The
developer MUST NOT need to invoke `docker compose` to start the frontend.

#### Scenario: `pnpm dev:web` starts Vite without docker

- GIVEN the developer is at the repo root on the host
- WHEN `pnpm dev:web` is executed
- THEN the Vite dev server binds to `0.0.0.0:5173`, reports `ready in <ms>`,
  and the browser at `http://localhost:5173` loads the SPA.

#### Scenario: No docker required for the frontend

- GIVEN `docker compose -f docker-compose.dev.yml down` was just run (all
  containers stopped)
- WHEN the developer runs `pnpm dev:web`
- THEN the SPA still serves correctly (postgres+localstack can also be down;
  this scenario only asserts the frontend doesn't depend on them).

### Requirement: docker-compose.dev.yml does not declare a `frontend` service

`docker-compose.dev.yml` MUST list only the services the dev environment
needs externally: `postgres` (for the DB) and `localstack` (for the AWS
managed services). A `frontend` service entry MUST NOT exist. The
`docker/frontend/` directory referenced by the previous SDD's Dockerfile
build context MUST be gone (see `frontend-vite-env-simplification.spec.md`
REQ-FVE-5).

#### Scenario: No `frontend:` service in compose

- GIVEN `docker-compose.dev.yml` after the change
- WHEN
  `grep -nE '^  frontend:' docker-compose.dev.yml`
  is run
- THEN no match is returned.

#### Scenario: Compose `ps` shows only postgres + localstack

- GIVEN `docker compose -f docker-compose.dev.yml up -d` was just run
- WHEN `docker compose -f docker-compose.dev.yml ps --services` is run
- THEN the output is exactly `postgres` and `localstack` (one per line, no
  `frontend` line).

### Requirement: `.env.development` declares VITE_API_BASE_URL

`packages/frontend/.env.development` MUST contain a value for
`VITE_API_BASE_URL`. The value MUST point at the dev server's mount path
(`http://localhost:3001/api/v1`). No `VITE_API_BASE_URL` value pointing at
the previous deployer endpoint (`http://s3-proxy:4566` or any
`http://*:4566` URL) MUST remain.

#### Scenario: Default dev URL is the wrapper-native server

- GIVEN the developer's working tree after the change
- WHEN `cat packages/frontend/.env.development` is run
- THEN the file contains a line of the form
  `VITE_API_BASE_URL=http://localhost:3001/api/v1`.

#### Scenario: No leftover proxy endpoint

- GIVEN the change is applied
- WHEN
  `grep -rE 's3-proxy|API_GATEWAY_HOST_EXTERNAL' packages/frontend/.env.development packages/frontend/.env.production`
  is run
- THEN no matches are returned.

### Requirement: Frontend HMR works without docker bind-mounts

With the frontend running natively, Vite's HMR MUST observe file changes
inside `packages/frontend/src/` and reload the SPA. No additional bind-mount
configuration is required (native file watching replaces the previous
docker bind-mount of `./:/app`).

#### Scenario: HMR triggers on source change

- GIVEN the SPA is loaded at `http://localhost:5173` and the developer
  edits `packages/frontend/src/services/http.ts`
- WHEN the file is saved
- THEN the running Vite dev server pushes a hot-module-replacement event
  and the SPA reflects the change in the browser without a full reload.

## Edge cases

- **EC-1 — `pnpm dev` (root) orchestrates all three pieces.** The root
  `pnpm dev` script is wired (in `native-dev-server.spec.md`) to run
  `dev:up` (docker compose up), `dev:api` (wrapper-native dev server), and
  `dev:web` (Vite) concurrently. If the developer runs `pnpm dev` instead
  of `pnpm dev:web`, the SPA still works because all three pieces are
  orchestrated.
- **EC-2 — Frontend-only flow without DB.** A developer working on UI
  changes may want to run only `pnpm dev:web` without postgres+localstack.
  Vite serves the SPA and the HTTP client fails on the first API call with
  a clear network error (because the dev server is not running). This is
  acceptable; the frontend's fail-loud behavior (see
  `frontend-http-client.spec.md` REQ-FHC-2) gives a clear message when
  the env var is missing — a missing dev server is a different kind of
  failure (network error at request time, not build-time).
- **EC-3 — Production build unaffected.** This spec is dev-only. The
  production build still uses Vite's static build (`vite build`) and ships
  the bundle to CloudFront. The `docker/frontend/` directory was a dev
  tool only; production deploys go through `packages/infra/` CDK stack.

## Non-functional requirements

- **NFR-1 — HMR latency.** Editing any file under
  `packages/frontend/src/` MUST result in a Vite HMR event within 500ms
  on the developer's machine (measured wall clock).
- **NFR-2 — Zero docker overhead.** Running `pnpm dev:web` MUST NOT touch
  the docker daemon. Verified by `docker events --since=5m --until=now`
  showing no events during a 5-minute editing session.

## Open questions for design

None. The decision to run the frontend natively is locked at the proposal
level (see `proposal.md` §2.1 row 7). This spec only captures the
observable consequences.

## Acceptance scenario summary

| Requirement                             | Pass condition                                                           |
| --------------------------------------- | ------------------------------------------------------------------------ |
| REQ-FNR-1 (native dev:web)              | `pnpm dev:web` starts Vite on `:5173` without docker                     |
| REQ-FNR-2 (no compose frontend service) | `docker-compose.dev.yml` lists only `postgres` and `localstack`          |
| REQ-FNR-3 (env declares URL)            | `.env.development` sets `VITE_API_BASE_URL=http://localhost:3001/api/v1` |
| REQ-FNR-4 (HMR works)                   | Saving a `src/` file triggers a Vite HMR push                            |

## Out of scope for this change

- Adding a `pnpm dev:web:prod` command that mimics the old
  docker-bind-mounted production-like flow.
- Running the frontend in a container for CI / e2e isolation — that's a
  different change (CI uses ephemeral containers or `pnpm exec playwright
test` against a built bundle).
- Removing the `docker/` directory from the repo. Only `docker/frontend/`
  is removed; `docker/postgres-init/` and `docker/deployer/` (the latter
  is removed in `docker-env-minimal.spec.md`) are out of scope here.

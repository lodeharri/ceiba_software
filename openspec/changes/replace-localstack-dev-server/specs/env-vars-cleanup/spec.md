# Env Vars Cleanup Specification

## Purpose

Removes stale environment variables from `.env.dev` and `.env.dev.example`
that referenced the deleted `deployer` and `s3-proxy` sidecars and the
`shared-data` volume. Variables still meaningful in the new flow (postgres
creds, LocalStack host/port, AWS region/access-key for SDK calls, JWT secret,
stage, frontend port, `VITE_API_BASE_URL`) MUST remain and MUST keep their
existing semantics. The goal is one consistent `.env.dev*` pair with no dead
keys that suggest a sidecar that no longer exists.

## Domain primitives

| Variable group                                              | Owned here  | Consumed by                                   |
| ----------------------------------------------------------- | ----------- | --------------------------------------------- |
| `POSTGRES_*`, `DATABASE_URL`                                | yes         | handlers (Prisma), seed Lambda, dev server    |
| `LOCALSTACK_HOST`, `LOCALSTACK_PORT`                        | yes         | handlers and scripts that use AWS SDK         |
| `LOCALSTACK_SERVICES` (if used as a single source)          | yes         | (compose-only env; not consumed by app code)  |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`  | yes         | AWS SDK in handlers; LocalStack compatibility |
| `STAGE=localstack`                                          | yes         | code paths that branch on stage               |
| `JWT_SECRET`, `JWT_SECRET_PREVIOUS`                         | yes         | auth-lambda, JWT middleware in every Lambda   |
| `FRONTEND_PORT`                                             | yes         | Vite config, README                           |
| `VITE_API_BASE_URL`                                         | yes         | `packages/frontend/src/services/http.ts`      |
| `LOCAL_DEV_NETWORK_NAME`                                    | yes         | compose (kept from before)                    |
| Container port overrides (postgres / LocalStack host ports) | yes         | `docker-compose.dev.yml`                      |
| `AWS_ENDPOINT_URL_S3`                                       | **REMOVED** | was used by `s3-proxy` only                   |
| `LOCALSTACK_BIND_HOST`                                      | **REMOVED** | was a `deployer` workaround                   |
| `LAMBDA_*` (any prefix)                                     | **REMOVED** | was a `deployer` artifact                     |
| `DEPLOYER_*` (any prefix)                                   | **REMOVED** | was a `deployer` artifact                     |
| `S3_PROXY_*` (any prefix)                                   | **REMOVED** | was an `s3-proxy` artifact                    |
| `SHARED_DATA_DIR`                                           | **REMOVED** | was the `shared-data` volume mount path       |
| `API_URL_FILE`                                              | **REMOVED** | was the file the deployer wrote for frontend  |
| `API_GATEWAY_HOST_EXTERNAL`                                 | **REMOVED** | was the APIGW hostname the deployer wrote     |

## Requirements

### Requirement: Stale env vars are absent from .env.dev* files

The `.env.dev` and `.env.dev.example` files at the repo root MUST NOT define
any of the removed keys (or any key whose name starts with one of the removed
prefixes). The system MUST NOT re-introduce them as commented-out lines in
this change.

#### Scenario: grep over .env.dev finds no removed keys

- GIVEN `.env.dev` and `.env.dev.example` after the change
- WHEN
  `grep -E '^(AWS_ENDPOINT_URL_S3|LOCALSTACK_BIND_HOST|LAMBDA_[A-Z_]+|DEPLOYER_[A-Z_]+|S3_PROXY_[A-Z_]+|SHARED_DATA_DIR|API_URL_FILE|API_GATEWAY_HOST_EXTERNAL)=' .env.dev .env.dev.example`
  is run
- THEN no lines are returned (exit code `1` from grep = no match)

#### Scenario: No commented-out stragglers

- GIVEN the trimmed files
- WHEN `grep -E '^#.*(AWS_ENDPOINT_URL_S3|LOCALSTACK_BIND_HOST|LAMBDA_|DEPLOYER_|S3_PROXY_|SHARED_DATA_DIR|API_URL_FILE|API_GATEWAY_HOST_EXTERNAL)' .env.dev .env.dev.example`
  is run
- THEN no commented lines mention any of the removed keys

### Requirement: Kept env vars remain present and equivalent

The `.env.dev.example` file MUST continue to define each of the kept variables
above, with the same semantics the pre-change version had. The system MUST NOT
rename any kept variable in this change.

#### Scenario: Kept vars are still present

- GIVEN the trimmed `.env.dev.example`
- WHEN the file is read
- THEN it defines `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
  `POSTGRES_PORT`, `DATABASE_URL`, `LOCALSTACK_HOST`, `LOCALSTACK_PORT`,
  `LOCAL_DEV_NETWORK_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `STAGE`, `JWT_SECRET`, `FRONTEND_PORT`, and
  `VITE_API_BASE_URL`

#### Scenario: VITE_API_BASE_URL points at the dev server

- GIVEN `packages/frontend/.env.development` after the change
- WHEN the file is read
- THEN `VITE_API_BASE_URL=http://localhost:3001/api/v1` is set
  (matches the new base URL in `frontend-http-client` spec)

### Requirement: Code references to removed env vars are gone

No TypeScript file, shell script, or compose file under the repo root MUST
reference a removed env var by name. The system MUST fail CI if such a
reference is reintroduced.

#### Scenario: grep over packages/, scripts/, and docker-compose finds no removed keys

- GIVEN the trimmed `.env.dev*` files and a clean tree
- WHEN
  `grep -rE 'AWS_ENDPOINT_URL_S3|LOCALSTACK_BIND_HOST|LAMBDA_[A-Z_]+|DEPLOYER_[A-Z_]+|S3_PROXY_[A-Z_]+|SHARED_DATA_DIR|API_URL_FILE|API_GATEWAY_HOST_EXTERNAL' packages/ scripts/ docker-compose.dev.yml docker/`
  is run
- THEN no matches are returned (with the exception of any historical
  documentation already covered by the `docs-rewrite` spec)

#### Scenario: No code reads /shared/.api-url or API_URL_FILE

- GIVEN the cleaned tree
- WHEN
  `grep -rE '/shared/\.api-url|API_URL_FILE' packages/ scripts/`
  is run
- THEN no matches are returned

### Requirement: .env.dev and .env.dev.example stay in sync

Every variable present in `.env.dev` MUST also appear in `.env.dev.example`
(possibly with a different value), and the example file MUST NOT introduce
keys that the active `.env.dev` does not use.

#### Scenario: example file is a superset of active keys minus secrets

- GIVEN `.env.dev` and `.env.dev.example`
- WHEN
  `diff <(grep -E '^[A-Z_]+=' .env.dev | cut -d= -f1 | sort) <(grep -E '^[A-Z_]+=' .env.dev.example | cut -d= -f1 | sort)`
  is run
- THEN the diff produces only expected differences (e.g. `.env.dev.example` may
  add placeholder keys but never drops ones present in `.env.dev`)

## Edge cases

- **EC-1 — Case sensitivity.** Env var matching is case-sensitive on Linux.
  The grep patterns above MUST use uppercase. A lowercase variant
  (e.g. `localstack_bind_host`) is a different variable and is not covered by
  this removal — but if any exists it MUST be removed too.
- **EC-2 — `.env.dev.local` untracked file.** Local untracked overrides (e.g.
  `.env.dev.local`) are developer-specific and not under source control; the
  cleanup applies only to the tracked files `.env.dev` and `.env.dev.example`.
- **EC-3 — `JWT_SECRET_PREVIOUS` retention.** Dual-secret rotation (per
  `add-inventory-mvp/specs/auth/spec.md`) keeps `JWT_SECRET_PREVIOUS` as a
  valid rotation knob; this spec does NOT remove it.
- **EC-4 — Frontend port parity.** `FRONTEND_PORT` MUST match what the dev
  script uses (default `5173`, Vite default). If the team standardizes on a
  different port in the future, the change happens in `frontend-vite-env-simplification`,
  not here.

## Non-functional requirements

- **NFR-1 — File size.** Each `.env.dev*` file SHOULD be ≤ 30 lines after the
  cleanup (the trim removes ~9 lines).
- **NFR-2 — No semantic drift.** Kept variables MUST retain their pre-change
  semantics; only the removed set changes.

## Open questions for design

None. The removed set and kept set are both locked by the proposal §3.4.

## Acceptance scenario summary

| Requirement                   | Pass condition                                                          |
| ----------------------------- | ----------------------------------------------------------------------- |
| REQ-EVC-1 (no removed keys)   | grep returns 0 matches for the removed set across `.env.dev*`           |
| REQ-EVC-2 (kept keys present) | Required kept keys are present in `.env.dev.example`                    |
| REQ-EVC-3 (no code refs)      | grep across `packages/`, `scripts/`, compose, docker/ returns 0 matches |
| REQ-EVC-4 (in sync)           | `.env.dev.example` keys are a superset of `.env.dev` keys               |

## Out of scope for this change

- Adding new env vars beyond the kept set.
- Changing the value of any kept var.
- Refactoring how env vars are loaded (e.g. switching to a secrets manager).
- Touching `packages/*/.env.example` files (those are BC-specific templates
  owned by their respective changes).
- Removing the unused `JWT_SECRET_PREVIOUS` placeholder.

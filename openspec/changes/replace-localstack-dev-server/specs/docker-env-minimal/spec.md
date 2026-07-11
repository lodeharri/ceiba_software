# Docker Compose Minimal Specification

## Purpose

Trims `docker-compose.dev.yml` to the two services local development actually
needs in the new flow: `postgres` (with pgvector) and `localstack` (re-scoped to
the AWS-managed services LocalStack Community actually simulates — S3, SQS, SNS,
Secrets Manager, plus the IAM/STS/CloudFormation trio retained for local CDK
synth sanity checks). The wrapper that drove CDK-in-LocalStack (`deployer`) and
the nginx-sidecar `s3-proxy` are removed along with their shared volume. The
goal is one compose file, fewer moving parts, no fake API Gateway in the path.

## Domain primitives

| Primitive                   | Owned here                   | Consumed by                            |
| --------------------------- | ---------------------------- | -------------------------------------- |
| `docker-compose.dev.yml`    | yes                          | `pnpm dev:up`, `pnpm dev:down`         |
| `postgres:16` service       | yes (existing, unchanged)    | every Lambda handler, prisma, seed     |
| `pgvector` extension        | yes (existing, unchanged)    | AI adapters (OllamaAdapter embeddings) |
| `localstack/localstack:3.4` | yes (kept, SERVICES trimmed) | dev-time S3/SQS/SNS/Secrets usage      |
| `shared-data` named volume  | **REMOVED** (no longer used) | nothing                                |
| `deployer` service          | **REMOVED**                  | nothing                                |
| `s3-proxy` service          | **REMOVED**                  | nothing                                |

> All compose-side references to `deployer`, `s3-proxy`, and `shared-data` MUST
> be gone in the same change; tasks phase must grep for stragglers.

## Requirements

### Requirement: docker-compose.dev.yml contains exactly postgres + localstack

The `docker-compose.dev.yml` file at the repo root MUST declare exactly two
services: `postgres` and `localstack`. The system MUST NOT declare `deployer`,
`s3-proxy`, `frontend`, `redis`, `pgadmin`, or any other service in this file
for this change.

#### Scenario: docker compose config --services lists exactly two

- GIVEN the trimmed `docker-compose.dev.yml`
- WHEN `docker compose -f docker-compose.dev.yml config --services` is run
- THEN the output is exactly the two lines `postgres` and `localstack` (order
  not guaranteed; no other service names appear)

#### Scenario: deployer and s3-proxy are gone

- GIVEN the trimmed `docker-compose.dev.yml`
- WHEN the file is read
- THEN no service key contains the strings `deployer` or `s3-proxy` (case
  insensitive); no `image:` directive references `node:20-cdk` or `nginx`
  inside a service block of this file

### Requirement: LocalStack SERVICES env is trimmed to AWS-managed services only

The `localstack` service's `environment.SERVICES` MUST equal exactly the string
`serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation`. The system MUST
NOT include `apigateway` or `lambda` in this list (those are not emulated by the
wrapper anymore; the dev server replaces them).

#### Scenario: SERVICES env value

- GIVEN the trimmed `docker-compose.dev.yml`
- WHEN `docker compose -f docker-compose.dev.yml config | grep -A1 SERVICES`
  is run
- THEN the SERVICES value matches
  `serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation` exactly

#### Scenario: LocalStack health endpoint reports only the kept services

- GIVEN `pnpm dev:up` has finished and LocalStack reports ready
- WHEN `curl -s http://localhost:4566/_localstack/health` is run
- THEN the response body includes `"s3": "available"`, `"sqs": "available"`,
  `"sns": "available"`, `"secretsmanager": "available"` and does NOT include
  keys `"apigateway"` or `"lambda"`

#### Scenario: S3 and SecretsManager SDK calls succeed

- GIVEN LocalStack is running with the trimmed SERVICES list
- WHEN
  `aws --endpoint-url http://localhost:4566 s3 ls` and
  `aws --endpoint-url http://localhost:4566 secretsmanager list-secrets`
  are run
- THEN both commands exit `0` and return their respective resource listings

### Requirement: No deployer or s3-proxy containers exist after dev:up

After `pnpm dev:up` (or the equivalent `docker compose -f docker-compose.dev.yml
up -d`), the system MUST NOT have any container whose name or image matches
`deployer`, `s3-proxy`, `nginx`, or `aws-cdk`. The system MUST NOT bring up
helper containers in any conditional fallback.

#### Scenario: docker compose ps shows only postgres + localstack

- GIVEN `pnpm dev:up` completed successfully
- WHEN `docker compose -f docker-compose.dev.yml ps --services` is run
- THEN the output lists exactly `postgres` and `localstack`, both with state
  `running` (or `running (healthy)` once health checks pass)

#### Scenario: No image pull for cdk or nginx

- GIVEN `docker compose -f docker-compose.dev.yml pull` is run on a clean cache
- WHEN the pull output is inspected
- THEN no image name contains `node:20-cdk`, `aws-cdk`, or `nginx` (none of
  these are pulled by this compose file)

### Requirement: shared-data volume is gone

The trimmed `docker-compose.dev.yml` MUST NOT declare any named volume named
`shared-data` (or whose name matches `shared*`). The system MUST NOT mount a
`shared-data:/shared` bind or named-volume into any service.

#### Scenario: docker volume ls shows no shared-data

- GIVEN `pnpm dev:down` followed by `docker volume ls | grep shared`
- WHEN the grep runs on a clean state
- THEN no volume whose name contains `shared` is reported

### Requirement: postgres service and pgvector extension are unchanged

The `postgres` service definition (image, healthcheck, env, volume mounts for
its data directory, network attachment) MUST remain functionally identical to
the pre-change version. The `pgvector` extension MUST still be created at
initdb time via the existing `initdb.d` mechanism (or whatever mechanism the
existing compose uses).

#### Scenario: pg_isready reaches accepting connections

- GIVEN `pnpm dev:up` has finished
- WHEN `docker compose -f docker-compose.dev.yml exec postgres pg_isready -U postgres`
  is run
- THEN the exit code is `0` and the output contains
  `accepting connections`

#### Scenario: pgvector extension is available

- GIVEN the postgres container is running
- WHEN
  `docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -c "SELECT extname FROM pg_extension WHERE extname='vector';"`
  is run
- THEN the output contains `vector` (the extension is installed)

### Requirement: Removed files are deleted from the tree

The following files MUST be deleted from the repository as part of this change
(their presence would be a regression):

- `docker/deployer/Dockerfile`
- `docker/deployer/entrypoint.sh`
- `docker/s3-proxy/Dockerfile`
- `docker/s3-proxy/nginx.conf` (if present)
- `scripts/dev-up.sh`
- `scripts/dev-down.sh`

#### Scenario: No deployer/ or s3-proxy/ folders

- GIVEN the change is applied
- WHEN `ls docker/` is run from the repo root
- THEN the directory listing contains neither `deployer` nor `s3-proxy`
  subdirectories

#### Scenario: No legacy shell scripts

- GIVEN the change is applied
- WHEN `ls scripts/` is run from the repo root
- THEN the listing contains neither `dev-up.sh` nor `dev-down.sh`

## Edge cases

- **EC-1 — Stale LocalStack container.** A previous run may have a container
  started with the old `SERVICES` list (including `apigateway` and `lambda`).
  The system MUST NOT crash on `docker compose up` if such a container exists
  with the same name; the new compose MUST recreate it with the trimmed env.
  Documented reset path: `docker compose down -v` clears state.
- **EC-2 — Port collision on 5432 / 4566.** If host ports 5432 (postgres) or
  4566 (LocalStack) are already taken, `docker compose up` MUST fail with the
  standard port-binding error; the dev server MUST NOT silently fall back to a
  different port. Documented in `docs/LOCAL-DEV.md`.
- **EC-3 — LocalStack edge service (`serverless`).** The `serverless` service
  is kept in the SERVICES list (proposal §3.3 retains it). If a future change
  drops it, the same trim workflow applies; this spec does not forbid it but
  the current value MUST contain it.
- **EC-4 — pgvector install timing.** The `vector` extension MUST be present
  before any handler that queries embeddings starts. The compose-level initdb
  hook MUST be the install mechanism (NOT a runtime migration).

## Non-functional requirements

- **NFR-1 — First-boot time.** `pnpm dev:up` MUST finish (both containers
  reporting healthy) in ≤ 30 seconds on a warm machine with images cached.
- **NFR-2 — Compose file size.** The trimmed `docker-compose.dev.yml` SHOULD
  be ≤ 80 lines (was ~150 with `deployer`, `s3-proxy`, and the shared volume).
- **NFR-3 — Health checks.** Both `postgres` and `localstack` MUST keep their
  pre-change healthcheck definitions (functional equivalence preserved).

## Open questions for design

- **OQ-DEM-1 (design):** Network name `LOCAL_DEV_NETWORK_NAME` — keep the
  pre-change default or pick a new one? Affects `package.json` env wiring.

## Acceptance scenario summary

| Requirement                    | Pass condition                                                            |
| ------------------------------ | ------------------------------------------------------------------------- |
| REQ-DEM-1 (only two services)  | `config --services` lists exactly `postgres` + `localstack`               |
| REQ-DEM-2 (SERVICES trimmed)   | Env matches `serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation` |
| REQ-DEM-3 (no sidecars)        | `compose ps --services` returns only postgres + localstack                |
| REQ-DEM-4 (no shared-data)     | `docker volume ls                                                         | grep shared` returns nothing |
| REQ-DEM-5 (postgres unchanged) | `pg_isready` returns 0; `pg_extension` contains `vector`                  |
| REQ-DEM-6 (deleted files)      | `ls docker/` and `ls scripts/` confirm removals                           |

## Out of scope for this change

- Adding new services (Ollama, MailHog, MinIO, etc.) — those are future changes.
- Changing the postgres image version or the pgvector install mechanism.
- Replacing the docker compose CLI with another orchestrator.
- Any change to the `packages/infra/src/stacks/*` CDK code.
- Switching LocalStack to the Pro image — Community (`localstack/localstack:3.4`)
  stays.

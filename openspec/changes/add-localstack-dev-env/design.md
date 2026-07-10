# Design: add-localstack-dev-env

This change adds a one-command local development stack for MercadoExpress: PostgreSQL with pgvector, LocalStack-hosted Lambda + API Gateway, an automatic CDK deployer, and a Vite frontend that discovers the deployed API URL without manual edits.

The design preserves the AWS deployment path by making `localstack` another stage, not another application architecture. Local-only differences live in infrastructure/configuration adapters: CDK stack selection, secret source, database TLS mode, and frontend API discovery.

## 1. Architecture Overview

### 1.1 Runtime topology

```text
┌─────────────────────────────────────────────────────────────┐
│  Host Machine                                                │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Frontend   │  │   Deployer   │  │   LocalStack │       │
│  │   :5173      │  │  (cdk deploy)│──│   :4566      │       │
│  │   (Vite)     │  │              │  │  (Lambda +   │       │
│  └──────┬───────┘  └──────┬───────┘  │   API GW)    │       │
│         │                 │          └──────┬───────┘       │
│         │                 │                 │                │
│         │                 │                 ▼                │
│         │                 │          ┌──────────────┐        │
│         │                 │          │  PostgreSQL  │        │
│         │                 │          │  :5432       │        │
│         │                 │          │  +pgvector   │        │
│         │                 │          └──────┬───────┘        │
│         │                 │                 │                │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │                 │                 │
          │  HTTP           │  DATABASE_URL   │
          │                 │                 │
          ▼                 ▼                 ▼
   ${VITE_API_BASE_URL}   ${DATABASE_URL}   localhost:5432
```

The diagram shows default ports for readability only. In the implementation, every port and host comes from `.env.dev` / `.env.dev.local`; `docker-compose.dev.yml` must not contain literal local port defaults.

### 1.2 Core decisions

| Area                      | Decision                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local AWS emulator        | LocalStack Community runs Lambda, API Gateway, CloudFormation, IAM, STS, SSM, Secrets Manager, and support services needed by the current CDK stacks.                                      |
| Database                  | `pgvector/pgvector:pg16` runs the same PostgreSQL major version expected by the app, with `vector` and `pgcrypto` initialized on first boot.                                               |
| CDK stage                 | Add `localstack` to the existing `Stage` union and stage tables. LocalStack is selected with `--context stage=localstack` and `STAGE=localstack`.                                          |
| Unsupported AWS resources | Skip RDS/VPC and CloudFront/S3 when `stage === 'localstack'` or explicit skip context flags are true.                                                                                      |
| Migrations                | Keep migrations inside the CDK custom resource path. For `localstack`, the migrations Lambda receives plain `DATABASE_URL` and `ADMIN_PASSWORD` env vars instead of AWS secret references. |
| Secrets                   | LocalStack stage reads `DATABASE_URL`, `JWT_SECRET`, and admin seed credentials from env vars. AWS stages keep the existing Secrets Manager / SSM path.                                    |
| API URL discovery         | The deployer extracts the `HttpApiUrl`/`ApiUrl` CDK output and writes it atomically to the shared `API_URL_FILE`; frontend reads that file before Vite starts.                             |
| Config source             | `.env.dev.example` documents defaults. `.env.dev` is required locally. `.env.dev.local` is optional and overrides `.env.dev`.                                                              |

### 1.3 Local data flow

1. Developer copies `.env.dev.example` to `.env.dev` once.
2. Developer runs `docker compose -f docker-compose.dev.yml up -d`.
3. Compose loads `.env.dev` and optional `.env.dev.local` for interpolation and container env.
4. PostgreSQL starts on the configured port and initializes `vector` + `pgcrypto` on an empty `pgdata` volume.
5. LocalStack starts on the configured edge port and attaches Lambda runtime containers to the configured Docker network.
6. Deployer waits for PostgreSQL and required LocalStack services, then runs CDK deploy with `stage=localstack` and skip flags.
7. CDK deploy creates local-compatible API + observability resources and runs the migration custom resource against the local PostgreSQL URL.
8. Deployer writes the API Gateway URL to `${API_URL_FILE}` in the shared volume.
9. Frontend waits for `${API_URL_FILE}`, exports `VITE_API_BASE_URL`, and starts Vite.
10. Browser calls the LocalStack API Gateway URL; Lambda handlers use the local PostgreSQL database.

## 2. File Structure

### 2.1 New files

- `docker-compose.dev.yml`
- `docker/postgres-init/01-pgvector.sql`
- `docker/deployer/Dockerfile`
- `docker/deployer/entrypoint.sh`
- `docker/deployer/wait-for-services.sh`
- `docker/frontend/Dockerfile`
- `docker/frontend/entrypoint.sh` — added to satisfy frontend startup validation and API URL retry behavior.
- `.env.dev.example`
- `docs/LOCAL-DEV.md`

### 2.2 Modified files

- `packages/infra/src/config.ts` — add `localstack` to `Stage`, stage tables, and local config helpers.
- `packages/infra/src/app.ts` — actual CDK entrypoint in this repo; the requested `packages/infra/bin/app.ts` path does not exist.
- `packages/infra/src/stacks/ApiStack.ts` — use `corsAllowOrigin`, direct local env values, and optional local migrations dependency.
- `packages/infra/src/stacks/DatabaseStack.ts` — keep AWS-only RDS behavior; thread stage-aware DB port/secret contract to migrations.
- `packages/infra/src/constructs/migrations.ts` — allow either AWS secret source or plain local env source.
- `packages/infra/src/constructs/migrations-lambda.ts` — branch by `STAGE` for direct local env values vs AWS Secrets Manager / SSM.
- `packages/backend/src/shared/prisma-client.ts` — append stage-aware `sslmode` and preserve existing query params.
- `packages/frontend/vite.config.ts` — read port/host/API URL from env and optional API URL file.
- `packages/frontend/src/services/http.ts` — remove the hardcoded API fallback URL; fail fast when `VITE_API_BASE_URL` is missing.
- `.gitignore` — allow `.env.dev.example`; ignore `.env.dev`, `.env.dev.local`, and `.api-url`.
- `README.md` — add a concise Local development section linking to `docs/LOCAL-DEV.md`.

## 3. Detailed Design per Component

### 3.1 `docker-compose.dev.yml`

`docker-compose.dev.yml` is the orchestration contract. It must use Compose env interpolation for every host, port, URL, secret, container name, network name, and volume name.

```yaml
name: ${COMPOSE_PROJECT_NAME}

# Requires Docker Compose v2.24+ for top-level env_file interpolation and optional files.
env_file:
  - path: .env.dev
    required: true
  - path: .env.dev.local
    required: false

x-env-files: &env_files
  - path: .env.dev
    required: true
  - path: .env.dev.local
    required: false

services:
  postgres:
    image: ${POSTGRES_IMAGE}
    container_name: ${POSTGRES_CONTAINER_NAME}
    env_file: *env_files
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      PGPORT: ${POSTGRES_PORT}
    command: ['postgres', '-c', 'port=${POSTGRES_PORT}']
    ports:
      - '${POSTGRES_PORT}:${POSTGRES_PORT}'
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    networks:
      - local-dev
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}" -p "$${POSTGRES_PORT}"',
        ]
      interval: ${HEALTHCHECK_INTERVAL}
      timeout: ${HEALTHCHECK_TIMEOUT}
      retries: ${POSTGRES_HEALTHCHECK_RETRIES}

  localstack:
    image: ${LOCALSTACK_IMAGE}
    container_name: ${LOCALSTACK_CONTAINER_NAME}
    env_file: *env_files
    environment:
      SERVICES: ${LOCALSTACK_SERVICES}
      DEFAULT_REGION: ${AWS_DEFAULT_REGION}
      AWS_DEFAULT_REGION: ${AWS_DEFAULT_REGION}
      DEBUG: ${LOCALSTACK_DEBUG}
      PERSISTENCE: ${LOCALSTACK_PERSISTENCE}
      GATEWAY_LISTEN: ${LOCALSTACK_BIND_HOST}:${LOCALSTACK_PORT}
      LAMBDA_DOCKER_NETWORK: ${LOCAL_DEV_NETWORK_NAME}
      LAMBDA_REMOVE_CONTAINERS: ${LOCALSTACK_LAMBDA_REMOVE_CONTAINERS}
    ports:
      - '${LOCALSTACK_PORT}:${LOCALSTACK_PORT}'
    volumes:
      - localstack-data:/var/lib/localstack
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - local-dev
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'curl -sf "http://$${LOCALSTACK_HOST}:$${LOCALSTACK_PORT}/_localstack/health" >/dev/null',
        ]
      interval: ${LOCALSTACK_HEALTHCHECK_INTERVAL}
      timeout: ${HEALTHCHECK_TIMEOUT}
      retries: ${LOCALSTACK_HEALTHCHECK_RETRIES}

  deployer:
    build:
      context: .
      dockerfile: docker/deployer/Dockerfile
    container_name: ${DEPLOYER_CONTAINER_NAME}
    env_file: *env_files
    environment:
      STAGE: ${STAGE}
      AWS_ENDPOINT_URL: ${AWS_ENDPOINT_URL}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      AWS_DEFAULT_REGION: ${AWS_DEFAULT_REGION}
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      ADMIN_USERNAME: ${ADMIN_USERNAME}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      FRONTEND_ORIGIN: ${FRONTEND_ORIGIN}
      API_URL_FILE: ${API_URL_FILE}
      CDK_OUTPUTS_FILE: ${CDK_OUTPUTS_FILE}
      API_GATEWAY_HOST_EXTERNAL: ${API_GATEWAY_HOST_EXTERNAL}
      API_GATEWAY_PORT: ${API_GATEWAY_PORT}
      LOCALSTACK_HOST: ${LOCALSTACK_HOST}
      LOCALSTACK_PORT: ${LOCALSTACK_PORT}
    depends_on:
      postgres:
        condition: service_healthy
      localstack:
        condition: service_healthy
    volumes:
      - shared-data:${SHARED_DATA_DIR}
    networks:
      - local-dev
    restart: on-failure
    healthcheck:
      test: ['CMD-SHELL', 'test -s "$${API_URL_FILE}"']
      interval: ${HEALTHCHECK_INTERVAL}
      timeout: ${HEALTHCHECK_TIMEOUT}
      retries: ${DEPLOYER_HEALTHCHECK_RETRIES}

  frontend:
    build:
      context: .
      dockerfile: docker/frontend/Dockerfile
    container_name: ${FRONTEND_CONTAINER_NAME}
    env_file: *env_files
    environment:
      API_URL_FILE: ${API_URL_FILE}
      VITE_API_BASE_URL: ${VITE_API_BASE_URL}
      FRONTEND_PORT: ${FRONTEND_PORT}
      VITE_HOST: ${VITE_HOST}
      API_URL_WAIT_TIMEOUT_SECONDS: ${API_URL_WAIT_TIMEOUT_SECONDS}
    ports:
      - '${FRONTEND_PORT}:${FRONTEND_PORT}'
    depends_on:
      deployer:
        condition: service_healthy
    volumes:
      - ./:/app
      - frontend-root-node-modules:/app/node_modules
      - frontend-package-node-modules:/app/packages/frontend/node_modules
      - shared-data:${SHARED_DATA_DIR}:ro
    networks:
      - local-dev
    healthcheck:
      test: ['CMD-SHELL', 'curl -sf "http://$${FRONTEND_HEALTH_HOST}:$${FRONTEND_PORT}" >/dev/null']
      interval: ${HEALTHCHECK_INTERVAL}
      timeout: ${HEALTHCHECK_TIMEOUT}
      retries: ${FRONTEND_HEALTHCHECK_RETRIES}

networks:
  local-dev:
    name: ${LOCAL_DEV_NETWORK_NAME}

volumes:
  pgdata:
    name: ${POSTGRES_VOLUME_NAME}
  localstack-data:
    name: ${LOCALSTACK_VOLUME_NAME}
  shared-data:
    name: ${SHARED_DATA_VOLUME_NAME}
  frontend-root-node-modules:
    name: ${FRONTEND_ROOT_NODE_MODULES_VOLUME_NAME}
  frontend-package-node-modules:
    name: ${FRONTEND_PACKAGE_NODE_MODULES_VOLUME_NAME}
```

Key details:

- `POSTGRES_PORT` is both the host and container PostgreSQL port so changing it rewires Lambda/migration connections, not only host access.
- LocalStack mounts Docker socket and uses `LAMBDA_DOCKER_NETWORK` so Lambda runtime containers can resolve the `postgres` service name.
- `deployer` does not bind-mount the source tree; it deploys the image-built code for deterministic first boot. Rebuild the deployer image after infra/backend changes.
- `frontend` bind-mounts the source tree for Vite HMR and uses node_modules volumes so the bind mount does not hide dependencies installed in the image.

### 3.2 `docker/postgres-init/01-pgvector.sql`

```sql
-- pgvector extension for embeddings.
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

This script runs only when the named `pgdata` volume is empty. Subsequent `docker compose down` / `up` cycles keep the extensions because the volume is preserved. `down -v` removes the volume and re-runs initialization on the next boot.

### 3.3 `docker/deployer/Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache bash curl jq postgresql-client
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/infra/package.json ./packages/infra/package.json

RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY docker/deployer/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/deployer/wait-for-services.sh /usr/local/bin/wait-for-services.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/wait-for-services.sh

WORKDIR /app/packages/infra
RUN pnpm build

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

The deployer owns infrastructure deployment only. It does not run the frontend dev server and does not perform host-level setup.

### 3.4 `docker/deployer/entrypoint.sh`

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

required_vars=(
  STAGE AWS_ENDPOINT_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
  DATABASE_URL JWT_SECRET ADMIN_USERNAME ADMIN_EMAIL ADMIN_PASSWORD FRONTEND_ORIGIN
  LOCALSTACK_HOST LOCALSTACK_PORT API_GATEWAY_HOST_EXTERNAL API_GATEWAY_PORT
  API_URL_FILE CDK_OUTPUTS_FILE
)

for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required env var ${name} is missing or empty. Check .env.dev and .env.dev.local." >&2
    exit 1
  fi
done

mask_value() {
  local name="$1"
  local value="$2"
  case "$name" in
    *PASSWORD*|*SECRET*|*TOKEN*|DATABASE_URL) printf '<masked>' ;;
    *) printf '%s' "$value" ;;
  esac
}

echo "Resolved local development configuration:"
for name in "${required_vars[@]}" POSTGRES_HOST POSTGRES_PORT FRONTEND_PORT; do
  [[ -n "${!name:-}" ]] || continue
  printf '  %s=%s\n' "$name" "$(mask_value "$name" "${!name}")"
done

echo "Waiting for dependent services..."
/usr/local/bin/wait-for-services.sh

cd /app/packages/infra

mkdir -p "$(dirname "$CDK_OUTPUTS_FILE")" "$(dirname "$API_URL_FILE")"
rm -f "$CDK_OUTPUTS_FILE" "$API_URL_FILE"

echo "Deploying CDK stacks to LocalStack..."
timeout "${CDK_DEPLOY_TIMEOUT_SECONDS:-300}" \
  pnpm exec cdk deploy \
    --context "stage=${STAGE}" \
    --context skipRds=true \
    --context skipCloudFront=true \
    --require-approval never \
    --outputs-file "$CDK_OUTPUTS_FILE" \
    "MercadoExpress-${STAGE}-Api" \
    "MercadoExpress-${STAGE}-Observability"

api_url="$(
  jq -er '
    [to_entries[]
      | select(.key | test("Api"))
      | .value
      | (.HttpApiUrl // .ApiUrl // .apiUrl // empty)
    ][0] // empty
  ' "$CDK_OUTPUTS_FILE"
)"

if [[ -z "$api_url" ]]; then
  echo "ERROR: CDK outputs did not contain HttpApiUrl or ApiUrl in an Api stack output." >&2
  jq '.' "$CDK_OUTPUTS_FILE" >&2 || true
  exit 1
fi

# If LocalStack emits a container-internal host, rewrite it to the configured host-visible API endpoint.
api_url="${api_url//$LOCALSTACK_HOST:$LOCALSTACK_PORT/$API_GATEWAY_HOST_EXTERNAL:$API_GATEWAY_PORT}"

printf '%s' "$api_url" > "${API_URL_FILE}.tmp"
mv "${API_URL_FILE}.tmp" "$API_URL_FILE"

echo "API URL written to ${API_URL_FILE}: ${api_url}"

# Keep the container alive so compose health can report the deploy result and logs remain available.
tail -f /dev/null
```

Failure behavior:

- Missing required env var: exit non-zero.
- Service readiness timeout: retry inside `wait-for-services.sh` until the configured retry window ends, then exit non-zero.
- `cdk deploy` failure: exit non-zero so Docker `restart: on-failure` retries.
- Missing API URL output after successful deploy: exit non-zero; do not silently fall back to a fake API URL.

### 3.5 `docker/deployer/wait-for-services.sh`

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

poll_interval="${SERVICE_WAIT_INTERVAL_SECONDS:-2}"
max_seconds="${SERVICE_WAIT_TIMEOUT_SECONDS:-300}"
deadline=$((SECONDS + max_seconds))

wait_for_postgres() {
  until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "ERROR: PostgreSQL did not become ready within ${max_seconds}s." >&2
      exit 1
    fi
    sleep "$poll_interval"
  done
}

wait_for_localstack() {
  local health_url="http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}/_localstack/health"
  local required="${LOCALSTACK_REQUIRED_SERVICES}"

  until curl -fsS "$health_url" -o /tmp/localstack-health.json \
    && jq -e --arg csv "$required" '
      ($csv | split(",")) as $requiredServices |
      all($requiredServices[]; (.services[.] == "available" or .services[.] == "running"))
    ' /tmp/localstack-health.json >/dev/null; do
    if (( SECONDS >= deadline )); then
      echo "ERROR: LocalStack services did not become ready within ${max_seconds}s." >&2
      cat /tmp/localstack-health.json >&2 2>/dev/null || true
      exit 1
    fi
    sleep "$poll_interval"
  done
}

wait_for_postgres
wait_for_localstack
```

The deployer waits twice: Compose `depends_on` handles coarse service health, and this script verifies the exact runtime contract before CDK starts.

### 3.6 `docker/frontend/Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/frontend/ ./packages/frontend/
COPY docker/frontend/entrypoint.sh /usr/local/bin/frontend-entrypoint.sh
RUN chmod +x /usr/local/bin/frontend-entrypoint.sh

WORKDIR /app/packages/frontend

ENTRYPOINT ["/usr/local/bin/frontend-entrypoint.sh"]
```

`EXPOSE` is intentionally omitted because the port is runtime-configurable through `FRONTEND_PORT`.

### 3.7 `docker/frontend/entrypoint.sh`

```sh
#!/bin/sh
set -eu

: "${API_URL_FILE:?API_URL_FILE is required}"
: "${FRONTEND_PORT:?FRONTEND_PORT is required}"
: "${VITE_HOST:?VITE_HOST is required}"

wait_timeout="${API_URL_WAIT_TIMEOUT_SECONDS:-300}"
elapsed=0

while [ ! -s "$API_URL_FILE" ]; do
  if [ "$elapsed" -ge "$wait_timeout" ]; then
    echo "ERROR: API URL file was not written within ${wait_timeout}s: ${API_URL_FILE}" >&2
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

export VITE_API_BASE_URL="$(cat "$API_URL_FILE")"
if [ -z "$VITE_API_BASE_URL" ]; then
  echo "ERROR: API URL file is empty: ${API_URL_FILE}" >&2
  exit 1
fi

echo "Starting Vite with VITE_API_BASE_URL=${VITE_API_BASE_URL}"
exec pnpm dev --host "$VITE_HOST" --port "$FRONTEND_PORT"
```

This script satisfies the missing-file retry scenario by waiting before Vite starts. Because Vite embeds env values at startup, this is safer than starting Vite with a placeholder and trying to mutate `import.meta.env` later.

### 3.8 `.env.dev.example`

```dotenv
# Compose project name; scopes container, network, and volume names for this local stack.
COMPOSE_PROJECT_NAME=ceiba-local-dev

# Named Docker network used by compose services and LocalStack Lambda runtime containers.
LOCAL_DEV_NETWORK_NAME=ceiba-local-dev

# PostgreSQL image with pgvector preinstalled; local development only.
POSTGRES_IMAGE=pgvector/pgvector:pg16

# PostgreSQL container name used by docs and troubleshooting commands.
POSTGRES_CONTAINER_NAME=ceiba-postgres

# PostgreSQL database user for local development only.
POSTGRES_USER=ceiba

# PostgreSQL password for local development only; do not reuse in real environments.
POSTGRES_PASSWORD=ceiba_dev

# PostgreSQL database name used by Prisma migrations and seed data.
POSTGRES_DB=mercadoexpress

# PostgreSQL host visible from compose services and LocalStack Lambda containers.
POSTGRES_HOST=postgres

# PostgreSQL host port and container port; change this if your machine already uses the default.
POSTGRES_PORT=5432

# Named volume preserving local PostgreSQL data across docker compose down/up.
POSTGRES_VOLUME_NAME=ceiba-postgres-data

# Prisma connection string for localstack; derived from the values above.
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}

# LocalStack image tag for the local AWS emulator.
LOCALSTACK_IMAGE=localstack/localstack:3.4

# LocalStack container name used by docs and troubleshooting commands.
LOCALSTACK_CONTAINER_NAME=ceiba-localstack

# LocalStack host visible from compose services.
LOCALSTACK_HOST=localstack

# LocalStack bind host inside the container.
LOCALSTACK_BIND_HOST=0.0.0.0

# LocalStack edge/API Gateway port; change this if your machine already uses the default.
LOCALSTACK_PORT=4566

# LocalStack data volume preserving emulator state between restarts.
LOCALSTACK_VOLUME_NAME=ceiba-localstack-data

# LocalStack services required by CDK, Lambda runtime, API Gateway, and observability resources.
LOCALSTACK_SERVICES=lambda,apigateway,apigatewayv2,secretsmanager,ssm,iam,cloudformation,sts,logs,cloudwatch,sns

# Services that must be ready before CDK deploy begins.
LOCALSTACK_REQUIRED_SERVICES=lambda,apigateway,secretsmanager,ssm,iam,cloudformation,sts

# LocalStack debug flag; keep disabled unless troubleshooting emulator behavior.
LOCALSTACK_DEBUG=0

# LocalStack persistence flag; keeps emulator state in the named volume.
LOCALSTACK_PERSISTENCE=1

# Whether LocalStack removes Lambda runtime containers after invocation.
LOCALSTACK_LAMBDA_REMOVE_CONTAINERS=1

# Dummy AWS access key for LocalStack only.
AWS_ACCESS_KEY_ID=test

# Dummy AWS secret key for LocalStack only.
AWS_SECRET_ACCESS_KEY=test

# AWS region used by CDK and SDK calls in local development.
AWS_DEFAULT_REGION=us-east-1

# Endpoint that routes AWS SDK/CDK calls from the deployer to LocalStack.
AWS_ENDPOINT_URL=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}

# Active CDK/runtime stage for the local stack.
STAGE=localstack

# JWT signing secret for local development only; do not reuse in real environments.
JWT_SECRET=dev-secret-change-me-in-prod-32chars-min

# Previous JWT secret for rotation tests; empty is valid for local steady state.
JWT_SECRET_PREVIOUS=

# Seed admin username used by the migrations custom resource in localstack.
ADMIN_USERNAME=admin

# Seed admin email used by the migrations custom resource in localstack.
ADMIN_EMAIL=admin@mercadoexpress.local

# Seed admin password for local development only; do not reuse in real environments.
ADMIN_PASSWORD=admin-local-dev-password-change-me

# Deployer container name used by docs and troubleshooting commands.
DEPLOYER_CONTAINER_NAME=ceiba-deployer

# Shared data directory mounted inside deployer and frontend containers.
SHARED_DATA_DIR=/shared

# Named volume used to pass CDK outputs and the API URL from deployer to frontend.
SHARED_DATA_VOLUME_NAME=ceiba-shared-data

# File written by cdk deploy with all stack outputs.
CDK_OUTPUTS_FILE=/shared/cdk-outputs.json

# Single source of truth file for the frontend API base URL.
API_URL_FILE=/shared/.api-url

# Host-visible API Gateway host used if LocalStack emits a container-internal URL.
API_GATEWAY_HOST_EXTERNAL=localhost

# Host-visible API Gateway port; defaults to the LocalStack edge port.
API_GATEWAY_PORT=${LOCALSTACK_PORT}

# Frontend container name used by docs and troubleshooting commands.
FRONTEND_CONTAINER_NAME=ceiba-frontend

# Host-visible frontend origin host.
FRONTEND_HOST_EXTERNAL=localhost

# Vite bind host inside the frontend container.
VITE_HOST=0.0.0.0

# Frontend health host inside the frontend container.
FRONTEND_HEALTH_HOST=localhost

# Vite dev server port; change this if your machine already uses the default.
FRONTEND_PORT=5173

# Browser origin allowed by API Gateway CORS in localstack.
FRONTEND_ORIGIN=http://${FRONTEND_HOST_EXTERNAL}:${FRONTEND_PORT}

# Initial fallback for Vite; deployer output file becomes the runtime source of truth.
VITE_API_BASE_URL=http://${API_GATEWAY_HOST_EXTERNAL}:${API_GATEWAY_PORT}

# Root node_modules volume name for the frontend bind-mounted dev server.
FRONTEND_ROOT_NODE_MODULES_VOLUME_NAME=ceiba-frontend-root-node-modules

# Package node_modules volume name for the frontend bind-mounted dev server.
FRONTEND_PACKAGE_NODE_MODULES_VOLUME_NAME=ceiba-frontend-package-node-modules

# Generic compose healthcheck interval.
HEALTHCHECK_INTERVAL=5s

# Generic compose healthcheck timeout.
HEALTHCHECK_TIMEOUT=5s

# PostgreSQL healthcheck retries before compose marks it unhealthy.
POSTGRES_HEALTHCHECK_RETRIES=10

# LocalStack healthcheck interval.
LOCALSTACK_HEALTHCHECK_INTERVAL=10s

# LocalStack healthcheck retries before compose marks it unhealthy.
LOCALSTACK_HEALTHCHECK_RETRIES=30

# Deployer healthcheck retries while waiting for the API URL file.
DEPLOYER_HEALTHCHECK_RETRIES=60

# Frontend healthcheck retries while Vite starts.
FRONTEND_HEALTHCHECK_RETRIES=30

# Poll interval used by deployer service readiness checks.
SERVICE_WAIT_INTERVAL_SECONDS=2

# Maximum time the deployer waits for PostgreSQL and LocalStack readiness.
SERVICE_WAIT_TIMEOUT_SECONDS=300

# Maximum time allowed for cdk deploy before Docker restarts the deployer.
CDK_DEPLOY_TIMEOUT_SECONDS=300

# Maximum time the frontend waits for the deployer API URL file.
API_URL_WAIT_TIMEOUT_SECONDS=300
```

`.env.dev.local` uses the same keys and overrides `.env.dev`. The most common override is a port collision, for example:

```dotenv
POSTGRES_PORT=5433
```

Because `DATABASE_URL` is derived from `POSTGRES_PORT`, the migrations Lambda and backend Lambdas connect to the changed port without code edits.

### 3.9 `packages/infra/src/config.ts` stage extension

The existing config module remains the single source of truth for stage tables. Add `localstack` everywhere the compiler requires stage completeness.

```ts
export type Stage = 'dev' | 'prod' | 'localstack';

export const STAGES: readonly Stage[] = ['dev', 'prod', 'localstack'] as const;

export function isLocalstackStage(stage: Stage): boolean {
  return stage === 'localstack';
}

export function resolveStage(rawStage: string | undefined): Stage {
  if (rawStage === 'prod') return 'prod';
  if (rawStage === 'localstack') return 'localstack';
  return 'dev';
}
```

Stage tables must add `localstack` entries, for example:

```ts
reservedConcurrencyByStage: {
  dev: 1,
  prod: undefined,
  localstack: undefined,
},

tagsByStage: {
  dev: { Project: PROJECT, Stage: 'dev', Owner: OWNER },
  prod: { Project: PROJECT, Stage: 'prod', Owner: OWNER },
  localstack: { Project: PROJECT, Stage: 'localstack', Owner: OWNER },
},

deletionProtectionByStage: {
  dev: false,
  prod: true,
  localstack: false,
},

alarmEmailByStage: {
  dev: 'ops+dev@mercadoexpress.local',
  prod: 'ops@mercadoexpress.local',
  localstack: 'ops+localstack@mercadoexpress.local',
},
```

### 3.10 `packages/infra/src/app.ts` skip logic

`packages/infra/src/app.ts` is the actual CDK app entrypoint in the repo. It should skip unsupported stacks in localstack while keeping dev/prod unchanged.

```ts
const skipRds = stage === 'localstack' || app.node.tryGetContext('skipRds') === 'true';
const skipCloudFront =
  stage === 'localstack' || app.node.tryGetContext('skipCloudFront') === 'true';
```

The stage graph becomes conditional:

```ts
export interface StageStacks {
  database?: DatabaseStack;
  frontend?: FrontendStack;
  api: ApiStack;
  observability: ObservabilityStack;
}

export function createStageStacks(app: App, stage: Stage, props?: StackProps): StageStacks {
  const skipRds = stage === 'localstack' || app.node.tryGetContext('skipRds') === 'true';
  const skipCloudFront =
    stage === 'localstack' || app.node.tryGetContext('skipCloudFront') === 'true';

  const database = skipRds
    ? undefined
    : new DatabaseStack(app, `MercadoExpress-${stage}-Database`, { stage, ...stackProps });
  const frontend = skipCloudFront
    ? undefined
    : new FrontendStack(app, `MercadoExpress-${stage}-Frontend`, { stage, ...stackProps });

  const corsAllowOrigin =
    stage === 'localstack'
      ? requiredEnv('FRONTEND_ORIGIN')
      : `https://${frontend!.distributionDomainName}`;

  const api = new ApiStack(app, `MercadoExpress-${stage}-Api`, {
    stage,
    corsAllowOrigin,
    databaseSource:
      stage === 'localstack'
        ? { kind: 'plain-env', databaseUrl: requiredEnv('DATABASE_URL') }
        : { kind: 'secret-arn', secretArn: database!.databaseUrlSecretArn },
    jwtSource:
      stage === 'localstack'
        ? {
            kind: 'plain-env',
            secret: requiredEnv('JWT_SECRET'),
            previousSecret: process.env.JWT_SECRET_PREVIOUS ?? '',
          }
        : { kind: 'ssm-parameter', parameterName: /* existing parameter path */ undefined },
    securityGroupId: database?.securityGroupId,
    ...stackProps,
  });

  const observability = new ObservabilityStack(app, `MercadoExpress-${stage}-Observability`, {
    stage,
    lambdaFunctionNames: API_LAMBDA_NAMES,
    ...stackProps,
  });

  if (database) {
    api.node.addDependency(database.migrationsNode);
    api.addDependency(database);
  }
  if (frontend) {
    api.addDependency(frontend);
  }
  observability.addDependency(api);

  return { database, frontend, api, observability };
}
```

The exact implementation can keep the current function shape, but the behavior contract is strict:

- `stage=localstack` creates no `DatabaseStack` and no `FrontendStack`.
- `stage=dev|prod` creates the same stacks as before.
- `ApiStack` and `ObservabilityStack` are always created.
- No business/domain code imports `Stage` or checks `STAGE`.

### 3.11 `packages/infra/src/stacks/ApiStack.ts`

Rename the CORS prop from the CloudFront-specific name to a generic origin value.

```ts
export interface ApiStackProps extends StackProps {
  stage: Stage;
  corsAllowOrigin: string;
  databaseSource: DatabaseSource;
  jwtSource: JwtSource;
  securityGroupId?: string;
}

type DatabaseSource =
  { kind: 'plain-env'; databaseUrl: string } | { kind: 'secret-arn'; secretArn: string };

type JwtSource =
  | { kind: 'plain-env'; secret: string; previousSecret: string }
  | { kind: 'ssm-parameter'; parameterName: string; previousParameterName: string };
```

CORS uses the already-resolved origin:

```ts
const corsAllowOrigins = [props.corsAllowOrigin];
```

Lambda environment values branch only in infrastructure wiring:

```ts
const databaseEnv =
  props.databaseSource.kind === 'plain-env'
    ? { DATABASE_URL: props.databaseSource.databaseUrl }
    : { DATABASE_URL: props.databaseSource.secretArn };

const jwtEnv =
  props.jwtSource.kind === 'plain-env'
    ? {
        JWT_SECRET: props.jwtSource.secret,
        JWT_SECRET_PREVIOUS: props.jwtSource.previousSecret,
      }
    : {
        JWT_SECRET: props.jwtSource.parameterName,
        JWT_SECRET_PREVIOUS: props.jwtSource.previousParameterName,
      };
```

For `localstack`, `ApiStack` also creates or depends on the migrations custom resource using the plain env source so AC-8 remains true even when `DatabaseStack` is skipped.

Output contract:

```ts
new CfnOutput(this, 'HttpApiUrl', {
  value: this.httpApi.apiEndpoint,
  description: 'HTTP API base URL',
  exportName: `MercadoExpress-${stage}-HttpApiUrl`,
});
```

The deployer will accept `HttpApiUrl` first and `ApiUrl` as a compatibility alias.

### 3.12 `packages/infra/src/stacks/DatabaseStack.ts`

`DatabaseStack` remains AWS-only for `dev|prod`. It is not instantiated for `localstack`.

Required adjustments:

- Keep current RDS behavior for AWS stages.
- Thread any database port value through config instead of local-dev hardcoded literals if tests grep the config layer.
- Keep `databaseUrlSecretArn`, `adminPasswordParameterName`, and `securityGroupId` as AWS outputs.
- Continue instantiating `MigrationsCustomResource` with the AWS secret source.

```ts
const migrations = new MigrationsCustomResource(this, 'Migrations', {
  stage,
  databaseSource: { kind: 'secret-arn', secretArn: this.databaseUrlSecretArn },
  adminPasswordSource: { kind: 'ssm-parameter', parameterName: this.adminPasswordParameterName },
});
```

### 3.13 `packages/infra/src/constructs/migrations.ts`

The construct should accept source variants instead of assuming AWS secret references.

```ts
type DatabaseSource =
  { kind: 'plain-env'; databaseUrl: string } | { kind: 'secret-arn'; secretArn: string };

type AdminPasswordSource =
  { kind: 'plain-env'; password: string } | { kind: 'ssm-parameter'; parameterName: string };

export interface MigrationsCustomResourceProps {
  stage: Stage;
  databaseSource: DatabaseSource;
  adminPasswordSource: AdminPasswordSource;
}
```

Environment contract:

```ts
environment: {
  STAGE: stage,
  ...(databaseSource.kind === 'plain-env'
    ? { DATABASE_URL: databaseSource.databaseUrl }
    : { DATABASE_SECRET_ARN: databaseSource.secretArn }),
  ...(adminPasswordSource.kind === 'plain-env'
    ? { ADMIN_PASSWORD: adminPasswordSource.password }
    : { ADMIN_PASSWORD_PARAM_NAME: adminPasswordSource.parameterName }),
  ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? 'admin',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'admin@mercadoexpress.local',
}
```

Permissions contract:

- Add `secretsmanager:GetSecretValue` only for `secret-arn` source.
- Add `ssm:GetParameter` only for `ssm-parameter` source.
- Add no secret-read permissions for `plain-env` localstack source.

### 3.14 `packages/infra/src/constructs/migrations-lambda.ts`

Branch at the adapter boundary, not in migrations logic.

```ts
async function resolveDatabaseUrl(): Promise<string> {
  if (process.env.STAGE === 'localstack') {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL env var is not set');
    return databaseUrl;
  }

  // Existing Secrets Manager path for dev/prod.
}

async function resolveAdminPassword(): Promise<string> {
  if (process.env.STAGE === 'localstack') {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD env var is not set');
    return password;
  }

  // Existing SSM SecureString path for dev/prod.
}
```

The migration command remains unchanged:

```ts
npx prisma migrate deploy --schema ./prisma/schema.prisma
npx tsx prisma/seed.ts
```

### 3.15 `packages/backend/src/shared/prisma-client.ts`

The Prisma client is the only backend runtime adapter that needs database TLS stage awareness.

```ts
function buildPrismaUrl(rawUrl: string, stage: string, connectionLimit: number): string {
  if (!rawUrl) throw new Error('DATABASE_URL env var is not configured');

  const url = new URL(rawUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(connectionLimit));
  }
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', stage === 'localstack' ? 'disable' : 'require');
  }
  return url.toString();
}

export function getPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  const g = globalThis as GlobalWithPrisma;
  if (!g.__mercadoExpressPrisma) {
    const stage = process.env.STAGE ?? 'dev';
    const dbUrl = buildPrismaUrl(
      process.env.DATABASE_URL ?? '',
      stage,
      options.connectionLimit ?? 2,
    );
    g.__mercadoExpressPrisma = new PrismaClient({
      log: options.log ?? ['warn', 'error'],
      datasources: { db: { url: dbUrl } },
    });
    g.__mercadoExpressPrisma.$connect();
  }
  return g.__mercadoExpressPrisma;
}
```

Tests must cover:

- `STAGE=localstack` appends `sslmode=disable`.
- `STAGE=dev` appends `sslmode=require`.
- Existing `sslmode` is preserved.
- Existing query params are preserved.

### 3.16 `packages/frontend/vite.config.ts`

Vite should not hardcode ports or URLs. The frontend entrypoint exports `VITE_API_BASE_URL`; Vite config can use the env value and only read the shared file as a safety fallback.

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

function readApiBaseUrl(): string | undefined {
  if (process.env.VITE_API_BASE_URL) return process.env.VITE_API_BASE_URL;
  const apiUrlFile = process.env.API_URL_FILE;
  if (apiUrlFile && existsSync(apiUrlFile)) {
    const value = readFileSync(apiUrlFile, 'utf8').trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mercadoexpress/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: process.env.VITE_HOST,
    port: Number(process.env.FRONTEND_PORT),
    strictPort: false,
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(readApiBaseUrl()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
```

### 3.17 `packages/frontend/src/services/http.ts`

Remove the hardcoded local fallback URL.

```ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error('VITE_API_BASE_URL is not configured');
}
```

This keeps configuration failures loud instead of silently sending browser traffic to a stale endpoint.

### 3.18 `.gitignore`

Existing `.env.*` ignores `.env.dev.example` unless explicitly negated. Add these entries:

```gitignore
# Local development compose env files
.env.dev
.env.dev.local
!.env.dev.example

# LocalStack/CDK generated API URL handoff
.api-url
```

### 3.19 `docs/LOCAL-DEV.md`

Required structure:

1. Prerequisites: Docker 24+, Docker Compose v2.24+, enough memory for LocalStack Lambda containers.
2. Quickstart:
   - `cp .env.dev.example .env.dev`
   - `docker compose -f docker-compose.dev.yml up -d`
   - `docker compose -f docker-compose.dev.yml ps`
3. Verification:
   - LocalStack health endpoint.
   - PostgreSQL extensions query.
   - API URL file exists.
   - Frontend returns HTML.
   - Products/auth smoke endpoint returns JSON or expected auth response.
4. Ports and overrides:
   - Use `.env.dev.local` for personal overrides.
   - Restart affected containers after changing ports.
5. Troubleshooting:
   - Port already occupied.
   - LocalStack slow first boot.
   - Stale `pgdata` volume.
   - Missing `.api-url` / deployer unhealthy.
   - Lambda cannot connect to `postgres` network.
6. Reset:
   - Preserve data: `docker compose -f docker-compose.dev.yml down`
   - Clean reset: `docker compose -f docker-compose.dev.yml down -v`

### 3.20 `README.md`

Add a short Local development section that links to the full guide rather than duplicating it.

````md
## Local development

For a full local backend + database + frontend stack, see [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md).

Quick path:

```bash
cp .env.dev.example .env.dev
docker compose -f docker-compose.dev.yml up -d
```
````

## 4. Sequence Diagrams

### 4.1 First boot flow

```text
User → docker compose up
  → Compose loads .env.dev and optional .env.dev.local
  → postgres starts on ${POSTGRES_PORT}
  → postgres runs init.sql (pgvector + pgcrypto) if pgdata is empty
  → localstack starts on ${LOCALSTACK_PORT}
  → deployer waits for postgres and required LocalStack services
  → deployer runs cdk deploy with stage=localstack
    → DatabaseStack SKIPPED
    → FrontendStack SKIPPED
    → localstack migrations custom resource runs Prisma migrations + seed
    → ApiStack created (Lambda + API Gateway, DATABASE_URL from env)
    → ObservabilityStack created
    → CDK outputs HTTP API URL to ${CDK_OUTPUTS_FILE}
  → deployer extracts API URL to ${API_URL_FILE}
  → frontend waits for ${API_URL_FILE}
  → frontend exports VITE_API_BASE_URL and starts Vite
  → user opens http://${FRONTEND_HOST_EXTERNAL}:${FRONTEND_PORT}
  → Vite serves SPA
  → user logs in
  → SPA calls ${VITE_API_BASE_URL}/api/v1/auth/login
  → LocalStack API Gateway routes to Lambda
  → Lambda reads DATABASE_URL and connects to PostgreSQL
```

### 4.2 Port override flow

```text
Developer writes .env.dev.local with POSTGRES_PORT=5433
  → Compose interpolation uses .env.dev.local override
  → postgres listens on 5433 inside the container
  → host publishes 5433:5433
  → DATABASE_URL is rebuilt with :5433
  → deployer passes DATABASE_URL to CDK
  → migration Lambda and API Lambdas connect to postgres:5433
```

### 4.3 Deployer retry flow

```text
deployer starts
  → validate required env vars
  → wait-for-services.sh polls postgres and LocalStack
  → if readiness exceeds timeout: exit non-zero
  → Docker restart policy restarts deployer
  → deployer re-reads env vars and retries from the beginning
  → if CDK deploy fails: exit non-zero and retry via Docker restart policy
  → if CDK succeeds but API URL output is missing: exit non-zero with output dump
  → if API URL exists: write ${API_URL_FILE} and become healthy
```

## 5. Risk Mitigations (cross-ref to proposal)

| Risk                                       | Mitigation in this design                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 LocalStack Community limitations       | `stage=localstack` skips RDS/VPC and CloudFront/S3. CDK context flags also make the skip explicit in deploy logs.                                                           |
| R-2 Slow first boot / Lambda cold start    | Deployer readiness waits up to the configured timeout and exits non-zero on deploy failures so Docker restarts it. LocalStack healthcheck uses generous retries.            |
| R-3 E2E must target LocalStack             | Deployer writes the actual CDK API output to `${API_URL_FILE}`; frontend reads that file as the source of truth. Future Playwright config can read the same file/env value. |
| R-4 Schema drift                           | Same Prisma migrations run through the same custom resource path in localstack and AWS stages.                                                                              |
| R-5 Volume growth / stale data             | `pgdata` is a named volume; docs include `down -v` clean reset and targeted volume cleanup.                                                                                 |
| R-6 Secret leakage                         | `.env.dev` and `.env.dev.local` are gitignored; only `.env.dev.example` is committed. Deployer logs mask secret values and `DATABASE_URL`.                                  |
| R-7 Port override confusion                | Deployer logs resolved non-secret config before deployment; docs explain that port changes require container restart.                                                       |
| Additional: Compose env-file interpolation | Require Docker Compose v2.24+ and use top-level `env_file` so `.env.dev` works with the mandated one-line `docker compose -f docker-compose.dev.yml up -d` command.         |
| Additional: Lambda-to-Postgres networking  | LocalStack mounts Docker socket and sets `LAMBDA_DOCKER_NETWORK` to the compose network so Lambda runtime containers resolve `postgres`.                                    |

## 6. AWS Deploy Compatibility

This change must not alter the dev/prod deployment model except where config names become more generic.

Future GitHub Actions flow:

1. Load `DATABASE_URL` or database secret reference from AWS Secrets Manager.
2. Load `JWT_SECRET` / previous secret from SSM or Secrets Manager.
3. Export the same env var keys used by localstack where appropriate.
4. Run CDK with `STAGE=dev|prod` and `--context stage=dev|prod`.
5. Do not pass `skipRds` or `skipCloudFront`.
6. CDK creates RDS/VPC and CloudFront/S3 as before.
7. Lambda runtime gets the AWS stage secret source; local direct-env bypass is inactive.

Compatibility rules:

- `Stage` is extended, not replaced.
- Existing `dev` and `prod` stack names remain stable.
- Existing AWS resources remain present for `dev|prod` synths.
- LocalStack-specific code lives in config/infra adapters only.
- No GitHub Actions workflow is added in this change.

## 7. Testing Strategy

### 7.1 Unit and synth tests

- `packages/infra/src/config.ts`
  - `resolveStage('localstack')` returns `localstack`.
  - Every `Record<Stage, ...>` includes `localstack`.
- `packages/infra/src/app.ts`
  - `stage=localstack` synth creates no `AWS::RDS::DBInstance`, `AWS::EC2::VPC`, or `AWS::CloudFront::Distribution`.
  - `stage=dev` synth preserves RDS and CloudFront resources.
- `packages/infra/src/stacks/ApiStack.ts`
  - Localstack Lambda env contains literal `DATABASE_URL` and literal `JWT_SECRET`.
  - Dev/prod Lambda env preserves existing secret indirection behavior.
  - CORS allow-origin is `FRONTEND_ORIGIN` for localstack.
- `packages/infra/src/constructs/migrations-lambda.ts`
  - `STAGE=localstack` reads `DATABASE_URL` and `ADMIN_PASSWORD` directly.
  - `STAGE=dev` uses Secrets Manager / SSM clients.
- `packages/backend/src/shared/prisma-client.ts`
  - `sslmode=disable` for localstack.
  - `sslmode=require` for dev/prod.
  - Existing `sslmode` and `connection_limit` query params are preserved.
- `packages/frontend/vite.config.ts` and `packages/frontend/src/services/http.ts`
  - Config reads `FRONTEND_PORT` and `VITE_HOST` from env.
  - HTTP client throws when `VITE_API_BASE_URL` is absent.

### 7.2 Manual smoke tests

```bash
cp .env.dev.example .env.dev
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
```

Verify:

```bash
curl "http://localhost:${LOCALSTACK_PORT}/_localstack/health"
docker exec ceiba-postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "\dx"
docker compose -f docker-compose.dev.yml exec deployer test -s "${API_URL_FILE}"
curl "http://localhost:${FRONTEND_PORT}"
```

Then read the API URL and smoke an endpoint:

```bash
API_URL="$(docker compose -f docker-compose.dev.yml exec -T deployer cat "${API_URL_FILE}")"
curl "${API_URL}/api/v1/products"
```

Expected response is HTTP 200 with JSON for public routes, or HTTP 401 with a typed JSON error envelope for protected routes.

### 7.3 Port override test

```bash
cat > .env.dev.local <<'EOF'
POSTGRES_PORT=5433
EOF

docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up -d
```

Verify PostgreSQL binds to the new port and deployer logs show the rebuilt `DATABASE_URL` host/port with the secret value masked.

### 7.4 Reset test

```bash
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up -d
# Data persists.

docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
# Database reinitializes extensions and migrations.
```

## 8. Slicing Mapping

### PR 1: Stage flags and env-driven config

Covers:

- `packages/infra/src/config.ts`
- `packages/infra/src/app.ts`
- `ApiStack` prop rename from `distributionDomainName` to `corsAllowOrigin`
- Stage table additions for `localstack`
- Synth tests for `localstack` and `dev`

Review lens: readability.

### PR 2: Skip RDS/CloudFront and local env bypass

Covers:

- `packages/infra/src/app.ts` conditional stack creation
- `packages/infra/src/stacks/ApiStack.ts` direct local `DATABASE_URL` / `JWT_SECRET`
- `packages/infra/src/constructs/migrations.ts`
- `packages/infra/src/constructs/migrations-lambda.ts`
- `packages/backend/src/shared/prisma-client.ts`
- No handler/use-case/domain changes

Review lens: risk.

### PR 3: Compose, PostgreSQL init, and deployer

Covers:

- `docker-compose.dev.yml`
- `docker/postgres-init/01-pgvector.sql`
- `docker/deployer/Dockerfile`
- `docker/deployer/entrypoint.sh`
- `docker/deployer/wait-for-services.sh`
- `.env.dev.example`
- `.gitignore`

Review lens: resilience.

### PR 4: Frontend container and documentation

Covers:

- `docker/frontend/Dockerfile`
- `docker/frontend/entrypoint.sh`
- `packages/frontend/vite.config.ts`
- `packages/frontend/src/services/http.ts`
- `docs/LOCAL-DEV.md`
- `README.md`

Review lens: readability.

<!-- End of design -->

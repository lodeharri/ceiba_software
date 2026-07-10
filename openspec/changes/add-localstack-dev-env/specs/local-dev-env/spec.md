# Spec: Local Development Environment

## Purpose

Provide a fully self-contained local development environment for MercadoExpress that runs the real backend (Lambda + API Gateway v2) on LocalStack, a real PostgreSQL with pgvector in a container, and the Vite frontend in a container — so developers can build, test, and iterate end-to-end without an AWS account, without touching the real cloud, and without manual setup steps.

## Requirements

### Requirement: Single-command bootstrap

The system MUST allow a developer to bring up the entire local stack (database, AWS mocks, CDK-deployed backend, and frontend) with a single command.

**As a** developer who just cloned the repo
**I want** to run one `docker compose` command
**So that** I have a working end-to-end environment without manual setup

#### Scenario: Fresh clone boot

- GIVEN a fresh clone of the repository with no `.env.dev` file
- WHEN the developer copies `.env.dev.example` to `.env.dev` and runs `docker compose -f docker-compose.dev.yml up -d`
- THEN within five minutes all four services (postgres, localstack, deployer, frontend) report healthy
- AND `curl http://localhost:${LOCALSTACK_PORT}/_localstack/health` returns HTTP 200
- AND `curl http://localhost:${FRONTEND_PORT}` returns HTML containing the application title

#### Scenario: Subsequent boot uses cached state

- GIVEN the developer has previously run the environment and the named volume `pgdata` still exists
- WHEN the developer runs `docker compose -f docker-compose.dev.yml up -d` again
- THEN the database container starts using the existing volume (no re-initialization)
- AND the CDK deployer re-runs against LocalStack and updates the stack

### Requirement: PostgreSQL with pgvector extension

The system MUST provide a PostgreSQL 16 instance with the `vector` (pgvector) and `pgcrypto` extensions initialized automatically, ready for the backend to connect without manual SQL setup.

**As a** backend service that uses pgvector
**I want** PostgreSQL with the required extensions pre-installed
**So that** migrations and seed scripts run without manual intervention

#### Scenario: Extensions are installed on first boot

- GIVEN the developer has never booted the environment before
- WHEN the postgres container finishes initializing
- THEN the `vector` and `pgcrypto` extensions are present in the database
- AND `docker exec ceiba-postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c "\dx"` lists both extensions

#### Scenario: Extensions persist across restarts

- GIVEN the database has been initialized at least once
- WHEN the developer runs `docker compose -f docker-compose.dev.yml down` and then `up -d` again
- THEN the extensions are still installed (no re-initialization required)

### Requirement: LocalStack with AWS service mocks

The system MUST expose LocalStack services required by the application (Lambda, API Gateway v2, Secrets Manager, SSM Parameter Store, IAM, CloudFormation, STS) at a configurable host and port so the deployed CDK stack behaves the same as against real AWS within the supported service subset.

**As a** CDK application
**I want** LocalStack to emulate the AWS services I depend on
**So that** my CDK synth and deploy commands work identically to a real AWS account

#### Scenario: LocalStack health endpoint responds

- GIVEN the localstack container is running
- WHEN the developer runs `curl http://localhost:${LOCALSTACK_PORT}/_localstack/health`
- THEN the response has HTTP status 200
- AND the response body lists the services `lambda`, `apigateway`, `secretsmanager`, `ssm`, `iam`, `cloudformation`, and `sts` as `available` (or `running`)

#### Scenario: AWS_ENDPOINT_URL routes SDK calls to LocalStack

- GIVEN the AWS SDK is configured with `AWS_ENDPOINT_URL=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}`
- WHEN the CDK deployer runs `cdk deploy`
- THEN all AWS API calls reach LocalStack instead of real AWS

### Requirement: CDK auto-deploy against LocalStack

The system MUST run `cdk deploy` automatically once LocalStack reports healthy, with no manual commands required from the developer, so the backend becomes reachable without extra steps.

**As a** developer
**I want** the CDK stack to deploy on its own
**So that** the backend is ready by the time I open the frontend

#### Scenario: Deploy starts only after LocalStack is ready

- GIVEN the deployer service starts before LocalStack is healthy
- WHEN the deployer entrypoint begins
- THEN it MUST poll LocalStack's health endpoint until the response indicates readiness
- AND only after readiness does it invoke `cdk deploy --context stage=localstack`

#### Scenario: Deploy succeeds without manual input

- GIVEN LocalStack is healthy and all environment variables from `.env.dev` are exported
- WHEN the deployer runs `cdk deploy`
- THEN the deploy completes without prompting for approval
- AND the stack outputs include an API URL

### Requirement: Lambdas respond to HTTP requests

The system MUST expose the deployed Lambda functions behind the LocalStack API Gateway endpoint so developers can verify the backend with `curl`.

**As a** developer verifying the backend
**I want** to hit API endpoints with curl
**So that** I can confirm the stack is functional end-to-end

#### Scenario: Products endpoint returns a response

- GIVEN the stack has finished deploying
- WHEN the developer runs `curl http://localhost:${API_GATEWAY_PORT}/<api-id>/<stage>/api/v1/products`
- THEN the response is HTTP 200 (or an authenticated 401 if the route requires a token)
- AND the response body is valid JSON

#### Scenario: API URL is derivable from CDK output

- GIVEN `cdk deploy` has finished
- WHEN the deployer captures stack outputs
- THEN the API Gateway URL is written to a file that the frontend service can read
- AND that URL MUST be the single source of truth for the frontend's `VITE_API_BASE_URL`

### Requirement: Frontend auto-configures its API base URL

The system MUST configure the Vite dev server's `VITE_API_BASE_URL` from the API URL produced by the CDK deployer so the frontend points to the correct backend without manual edits.

**As a** developer
**I want** the frontend to talk to the LocalStack API automatically
**So that** I don't edit config files when ports or paths change

#### Scenario: Vite reads VITE_API_BASE_URL at container start

- GIVEN the deployer has written the API URL to the shared file
- WHEN the frontend container starts
- THEN it MUST read the file and export the value as `VITE_API_BASE_URL`
- AND `curl http://localhost:${FRONTEND_PORT}` returns the Vite-served login screen

#### Scenario: Fallback when the shared file is missing

- GIVEN the frontend container starts before the deployer has written the API URL file
- WHEN Vite boots
- THEN it MUST retry reading the file until the deployer writes it (no permanent failure)
- AND once the file appears, Vite MUST expose the new value to the client (HMR or full reload)

### Requirement: Zero hardcoded configuration values

The system MUST NOT contain hardcoded URLs, hostnames, ports, secrets, or AWS ARNs in code, compose files, or CDK templates. Every configurable value MUST be sourced from environment variables with functional defaults.

**As a** platform owner
**I want** zero hardcoded values in the configuration layer
**So that** the same code runs locally and in AWS without edits

#### Scenario: No literal port numbers in source

- GIVEN a developer greps the codebase for hardcoded port numbers in the local-dev configuration layer
- WHEN they search for `5432`, `4566`, `5173`, or any other documented port
- THEN those values appear ONLY in `.env.dev.example` (as default documentation), NEVER in `docker-compose.dev.yml`, CDK stacks, or Lambda handler code

#### Scenario: No literal URLs in source

- GIVEN a developer greps the codebase for hardcoded `localhost` or `127.0.0.1` strings in the configuration layer
- WHEN they search
- THEN those strings appear ONLY as default values in `.env.dev.example`, never in source code

### Requirement: Configurable ports and hosts

The system MUST let a developer override any port or hostname used by the local stack via environment variables without modifying code, so two developers (or a developer with conflicting services) can run side by side.

**As a** developer with a port collision
**I want** to change a port in `.env.dev`
**So that** the stack still works without code changes

#### Scenario: Override a single port

- GIVEN the developer edits `.env.dev` and sets `POSTGRES_PORT=5433`
- WHEN the developer runs `docker compose -f docker-compose.dev.yml up -d`
- THEN postgres binds to host port 5433 instead of 5432
- AND the backend Lambdas and migrations connect to the new port automatically (because `DATABASE_URL` is rebuilt from `${POSTGRES_PORT}`)

#### Scenario: All documented ports are overridable

- GIVEN the documentation lists every configurable port
- WHEN a developer overrides any one of them
- THEN the rest of the stack continues to function without edits

### Requirement: Vendor-aware configuration

The system MUST detect the active stage from the `STAGE` environment variable and adjust its behavior (TLS mode, secrets source, RDS/CloudFront presence) accordingly, without duplicating business logic across stages.

**As a** platform owner
**I want** the code to behave correctly in `localstack`, `dev`, and `prod` from a single code path
**So that** we maintain one codebase instead of three forks

#### Scenario: Stage flag changes runtime behavior

- GIVEN the same backend image is started with `STAGE=localstack` and later with `STAGE=dev`
- WHEN the backend connects to its database
- THEN TLS is disabled in `localstack` and required in `dev`/`prod`
- AND secrets are read from environment variables in `localstack` and from Secrets Manager / SSM in `dev`/`prod`

#### Scenario: No duplicated business logic

- GIVEN a developer reads the domain and application layer of the backend
- WHEN they search for `STAGE` checks
- THEN those checks appear ONLY in infrastructure adapters (Prisma client, secrets resolvers), not in use cases or domain logic

### Requirement: Down preserves the database volume

The system MUST preserve the database named volume across `docker compose down` so a developer's local data (products, sessions, seed data) survives container restarts, while still allowing explicit reset via `down -v`.

**As a** developer who restarts the stack often
**I want** my local data to survive `down`
**So that** I don't re-seed every time

#### Scenario: Plain down keeps the data

- GIVEN the developer has seeded data in the local database
- WHEN they run `docker compose -f docker-compose.dev.yml down` and then `up -d` again
- THEN the previously inserted rows are still present

#### Scenario: Explicit reset wipes the data

- GIVEN the developer wants a clean slate
- WHEN they run `docker compose -f docker-compose.dev.yml down -v`
- THEN the `pgdata` named volume is removed
- AND the next `up -d` re-initializes the database (extensions and migrations run again)

### Requirement: Clean reset capability

The system MUST provide a documented one-shot procedure to reset the entire local environment to a clean state (remove all containers, networks, and named volumes created by the compose file).

**As a** developer troubleshooting a broken local state
**I want** a documented reset procedure
**So that** I can recover without searching the docs

#### Scenario: Reset returns to a fresh-clone state

- GIVEN the developer runs the documented reset procedure
- WHEN the procedure completes
- THEN no containers, networks, or named volumes from the local stack remain
- AND the next `up -d` behaves as if the developer had never run the environment before

### Requirement: Local development documentation

The system MUST ship a `docs/LOCAL-DEV.md` document covering first-time setup, common troubleshooting (port conflicts, stale volumes, slow first boot), and reset procedures so a new developer can self-serve.

**As a** new developer
**I want** a single document that explains how to start, troubleshoot, and reset the local environment
**So that** I don't have to ask teammates for help

#### Scenario: Setup section is sufficient for first boot

- GIVEN a new developer reads `docs/LOCAL-DEV.md`
- WHEN they follow only the setup section
- THEN they can complete the first successful boot without external help

#### Scenario: Troubleshooting section covers documented failure modes

- GIVEN the developer hits one of the documented failure modes (port conflict, stale volume, slow first boot)
- WHEN they read the troubleshooting section
- THEN they find a concrete command sequence that resolves the issue

## Edge cases

- **EC-1**: A developer's host already has port 5432 in use → the developer MUST be able to override `POSTGRES_PORT` in `.env.dev` and have the entire stack rewire without code edits (covered by REQ-CFG-2).
- **EC-2**: The first `cdk deploy` against a fresh LocalStack takes longer than the default healthcheck timeout → the deployer entrypoint MUST retry with a longer per-step timeout (up to 5 minutes total) and surface the timeout in logs.
- **EC-3**: The `pgdata` volume contains a stale schema from a previous version → the developer MUST be able to run `docker compose down -v` to reset and let migrations re-run.
- **EC-4**: AWS deploy vs local use different secret sources → the same env-var keys (`DATABASE_URL`, `JWT_SECRET`) MUST be sourced from `.env.dev` locally and from Secrets Manager / SSM in AWS, with no code change between the two.

## Non-functional

- **NFR-1**: Cold start of the backend (excluding the first build) MUST complete in under 30 seconds.
- **NFR-2**: Frontend hot-module reload MUST apply in under 2 seconds after a file save.
- **NFR-3**: All operations MUST work offline after the initial image pull — no runtime dependency on the public internet.
- **NFR-4**: The deployer MUST log every resolved port, host, and stage at startup so a developer can immediately see if an override was applied.

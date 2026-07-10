# Spec: Environment Variable Configuration

## Purpose

Make environment variables the single source of truth for every configurable value in the local development stack — ports, hosts, URLs, credentials, stage flags — so the same code runs locally and in AWS without modification, and so individual developers can override any value without touching shared files.

## Requirements

### Requirement: A committed example file documents every variable

The repository MUST contain a committed `.env.dev.example` file that lists every environment variable used by the local stack, each with a working default value and a brief comment explaining its purpose.

**As a** new developer
**I want** a copy-pasteable template with sensible defaults
**So that** I can boot the stack without guessing variable names

#### Scenario: Example file is present and complete

- GIVEN a fresh clone of the repository
- WHEN the developer inspects `.env.dev.example`
- THEN the file MUST list every env var the local stack consumes (postgres, localstack, stage, secrets, ports)
- AND every entry MUST have a default value that allows the stack to boot without further edits
- AND every entry MUST have a one-line comment naming its purpose

#### Scenario: Example file is tracked in git

- GIVEN the developer clones the repository
- WHEN they inspect `.gitignore`
- THEN `.env.dev.example` MUST NOT be in `.gitignore`
- AND the file MUST appear in `git ls-files`

### Requirement: The active env file is gitignored

The actual `.env.dev` file that the compose stack consumes MUST be in `.gitignore` so developers cannot accidentally commit personal overrides or local secrets.

**As a** repository maintainer
**I want** local env files to never reach the remote
**So that** we don't leak credentials or divergent overrides

#### Scenario: .env.dev is not tracked

- GIVEN the developer has copied `.env.dev.example` to `.env.dev` and possibly customized it
- WHEN they run `git status`
- THEN `.env.dev` MUST NOT appear as a tracked or modified file
- AND `.env.dev` MUST appear in the project's `.gitignore`

#### Scenario: Personal overrides are also ignored

- GIVEN the developer creates `.env.dev.local` for personal overrides
- WHEN they run `git status`
- THEN `.env.dev.local` MUST NOT appear as a tracked or modified file
- AND `.env.dev.local` MUST appear in the project's `.gitignore`

### Requirement: Personal override file layered on top

The system MUST support a `.env.dev.local` file whose values override those in `.env.dev` so a developer can change a port or secret for their machine without modifying the shared file.

**As a** developer with a port collision or local secret
**I want** to drop overrides in a personal file
**So that** my changes don't conflict with teammates'

#### Scenario: Local override wins over the shared file

- GIVEN `.env.dev` defines `POSTGRES_PORT=5432` and `.env.dev.local` defines `POSTGRES_PORT=5433`
- WHEN the compose stack starts
- THEN the resolved value of `POSTGRES_PORT` inside every container MUST be `5433`

#### Scenario: Missing local override is non-fatal

- GIVEN `.env.dev.local` does not exist
- WHEN the compose stack starts
- THEN the stack MUST boot using the values from `.env.dev` alone
- AND no error about the missing file is raised

### Requirement: Defaults are functional without edits

Every documented environment variable MUST have a default value that, when the developer copies `.env.dev.example` to `.env.dev` unchanged and runs `docker compose up -d`, allows the entire stack to come up healthy.

**As a** developer
**I want** defaults that work out of the box
**So that** I don't have to read every comment before my first boot

#### Scenario: Clean-boot scenario

- GIVEN the developer copied `.env.dev.example` to `.env.dev` without modification
- WHEN they run `docker compose -f docker-compose.dev.yml up -d`
- THEN all four services reach the healthy state described in the local-dev-env spec
- AND no service exits due to a missing required env var

#### Scenario: No required env var lacks a default

- GIVEN a developer inspects `.env.dev.example`
- WHEN they review each entry
- THEN no entry is empty or marked as "must be set" by the developer
- AND every required value has a working placeholder (e.g., `dev-secret-change-me-...`, dummy AWS keys)

### Requirement: Every variable is documented inline

Every variable in `.env.dev.example` MUST have a brief inline comment that describes its purpose, the default behavior, and any security note (e.g., "dev-only, change in production") so the file is self-documenting.

**As a** developer reading the env file
**I want** to understand what each variable does without searching docs
**So that** I can make informed overrides

#### Scenario: Comments cover purpose

- GIVEN a developer reads `.env.dev.example`
- WHEN they scan any variable
- THEN the immediately preceding comment MUST explain what the variable configures

#### Scenario: Secret variables carry a warning

- GIVEN the developer reads the `JWT_SECRET` or `POSTGRES_PASSWORD` entries
- WHEN they review the comment
- THEN the comment MUST indicate the value is for local development only and MUST NOT be reused in any real environment

### Requirement: Startup validation of required variables

The deployer and frontend services MUST validate that every required environment variable is set (non-empty) before they begin their main work, and MUST fail fast with a clear message when one is missing.

**As a** developer who accidentally deleted a variable
**I want** the stack to refuse to start with a clear error
**So that** I don't have to debug a cryptic downstream failure

#### Scenario: Missing required variable is reported by name

- GIVEN `.env.dev` is missing `JWT_SECRET`
- WHEN the deployer service starts
- THEN it MUST log a clear error naming the missing variable and the file it expected to find it in
- AND the container MUST exit non-zero so the failure is visible in `docker compose ps`

#### Scenario: All required variables present is non-fatal

- GIVEN `.env.dev` provides every required variable
- WHEN the deployer or frontend service starts
- THEN validation MUST pass silently
- AND the service MUST proceed to its main work without further log noise about configuration

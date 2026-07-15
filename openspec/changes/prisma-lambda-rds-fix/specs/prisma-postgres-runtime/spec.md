# Prisma PostgreSQL Runtime Specification

## Purpose

Portable runtime.

## Requirements

### Requirement: Portable Prisma client

The runtime MUST use Rust-free Prisma 6.x (minimum 6.17), `@prisma/adapter-pg`, and `pg`. Design MUST pin the latest exact 6.x patch. Output MUST be stable, gitignored, and independent of pnpm-store hashes.

#### Scenario: Runtime starts

- GIVEN a local or Lambda environment
- WHEN the client starts
- THEN PostgreSQL works without Rust engines

#### Scenario: Artifact drifts

- GIVEN package version or store-layout drift
- WHEN validation runs
- THEN deployment is blocked

### Requirement: Shared access

Application and seed access MUST share `getPrismaClient({ adapter? })`. Docker PostgreSQL, dev-server, migrate, and seed MUST be operational.

#### Scenario: Workflows run

- GIVEN local PostgreSQL is ready
- WHEN dev-server, migrate, and seed run
- THEN workflows succeed

#### Scenario: Adapter is supplied

- GIVEN a compatible adapter
- WHEN the shared factory is called
- THEN it uses that adapter

### Requirement: Transitional assets remain

The Prisma Layer and `.prisma-layer-build/` MUST remain REMOVE-LATER and MUST NOT be deleted in this change.

#### Scenario: Change is applied

- GIVEN runtime work is complete
- WHEN contents are reviewed
- THEN both assets remain

#### Scenario: Assets obsolete

- GIVEN the runtime no longer needs them
- WHEN cleanup is proposed
- THEN a later change is required

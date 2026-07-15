# Database Deployment Safety Specification

## Purpose

Safety.

## Requirements

### Requirement: Delivery is dev-first

Dev implementation and validation MUST precede commits and production promotion, using production-ready architecture and configuration. Full verification MUST pass first.

#### Scenario: Validation passes

- GIVEN the dev solution is complete
- WHEN verification succeeds
- THEN commit and promotion become eligible

#### Scenario: Verification is incomplete

- GIVEN a missing or failing check
- WHEN commit or promotion is requested
- THEN the action is blocked

### Requirement: Database success gates deployment

CloudFormation MUST require successful migrations and seed. Either failure MUST fail and block deployment; green CloudFormation with a broken database MUST NOT be reported.

#### Scenario: Preparation succeeds

- GIVEN valid migrations and seed
- WHEN preparation runs
- THEN deployment may continue

#### Scenario: Migration fails

- GIVEN a migration failure
- WHEN preparation is evaluated
- THEN CloudFormation fails and blocks dependents

#### Scenario: Seed fails

- GIVEN migration success and seed failure
- WHEN preparation is evaluated
- THEN CloudFormation fails and blocks dependents

### Requirement: Assets are preserved

Every environment MUST preserve schema, migration files, history, and data without destructive reset. This includes dev. pgvector and ADR-9 MUST be preserved or restored.

#### Scenario: Migration applies

- GIVEN an existing populated database
- WHEN pending migrations run
- THEN schema, history, and data remain

#### Scenario: Preservation regresses

- GIVEN reset behavior or missing pgvector or ADR-9
- WHEN readiness is evaluated
- THEN verification fails and deployment is blocked

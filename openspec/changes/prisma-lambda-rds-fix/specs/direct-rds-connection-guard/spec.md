# Direct RDS Connection Guard Specification

## Purpose

Bound direct connections.

## Requirements

### Requirement: Direct RDS usage is bounded

Each runtime MUST use direct RDS with pool maximum two. Each database-backed dev Lambda MUST reserve concurrency one. RDS Proxy MUST NOT be introduced.

#### Scenario: One invocation runs

- GIVEN an idle dev Lambda
- WHEN one invocation runs
- THEN it uses at most two connections

#### Scenario: Limits are saturated

- GIVEN one invocation and two connections
- WHEN concurrent demand arrives
- THEN no concurrent invocation or third connection opens

### Requirement: Connections are observable

Deployment MUST expose `DatabaseConnections` and MUST alarm at 80% of `max_connections`.

#### Scenario: Usage is healthy

- GIVEN usage below 80%
- WHEN monitoring evaluates connections
- THEN usage is visible without alarm

#### Scenario: Threshold is reached

- GIVEN usage reaches 80%
- WHEN monitoring evaluates connections
- THEN the alarm enters alert state

#### Scenario: Observability is absent

- GIVEN an unverifiable metric or alarm
- WHEN dev readiness is evaluated
- THEN validation fails

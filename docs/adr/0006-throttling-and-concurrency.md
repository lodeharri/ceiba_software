# ADR-0006: Throttling and Concurrency Limits

## Status

Accepted

## Context

AWS Lambda and API Gateway have default throttling limits that may be insufficient for production load. The risk review requires explicit configuration.

## Decision

### API Gateway Throttling

- **Burst**: 100 requests/second
- **Steady-state**: 50 requests/second

### Lambda Reserved Concurrency

- **dev**: 1 (prevents cold start issues during development)
- **prod**: undefined (uses account default, can be increased)

### CloudWatch Alarms

Three alarms per Lambda (per `design.md` §12.4):

1. Error rate > 1%
2. Duration > 3 seconds
3. Throttles > 0

## Consequences

### Positive

- **Predictable performance**: Known limits prevent runaway costs.
- **Observability**: Alarms provide early warning of issues.

### Negative

- **Rate limiting**: Legitimate bursts may be throttled.

## References

- Design: `design.md` §12.4, §15.3
- Config: `packages/infra/src/config.ts`

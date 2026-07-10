# ADR-0007: CloudWatch Log Retention

## Status

Accepted

## Context

CloudWatch Logs can accumulate large amounts of data, incurring high costs. The risk review requires log retention limits.

## Decision

All Lambda log groups have **7-day retention**:

- Error investigation possible without unlimited storage
- Cost is predictable and bounded
- Older logs can be exported to S3 for compliance if needed

```typescript
new LogGroup(this, `/${lambdaPath}`, {
  retention: RetentionDays.ONE_WEEK,
});
```

## Consequences

### Positive

- **Cost control**: ~700 MB/day budget (design estimate)
- **Compliance**: 7-day window covers most audit needs

### Negative

- **No long-term log retention**: Must export to S3 for compliance archives.

## References

- Design: `design.md` §12.2
- Risk: RISK-W10 (Log Volume)

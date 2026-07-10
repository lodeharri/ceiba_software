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

## Alternatives Considered

### 30-day CloudWatch retention

More headroom for incident analysis but roughly 4× the storage cost (~2.8 GB/day vs ~700 MB/day) without proportional value at MVP scale.

### Unlimited (never-expire) CloudWatch retention

Simplest configuration but unbounded cost — CloudWatch can become the dominant operational line item within months and contradicts RISK-W10.

### S3-only archival from day one

Cheapest long-term but loses CloudWatch Logs Insights queryability for the most recent week, slowing triage during an active incident.

## Consequences

### Positive

- **Cost control**: ~700 MB/day budget (design estimate)
- **Compliance**: 7-day window covers most audit needs

### Negative

- **No long-term log retention**: Must export to S3 for compliance archives.

## References

- Design: `design.md` §12.2
- Risk: RISK-W10 (Log Volume)

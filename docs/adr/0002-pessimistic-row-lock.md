# ADR-0002: Pessimistic Row Lock for Inventory Mutations

## Status

Accepted

## Context

Concurrent SALIDA (stock reduction) requests can race and both succeed, causing stock to go negative. PostgreSQL's default READ COMMITTED isolation level does not prevent this.

The risk review identified RISK-002: without locking, concurrent mutations can cause:

1. Stock going negative (two SALIDAs both read stock=10, both write stock=5)
2. Lost updates (alert created twice, stock updated incorrectly)

## Decision

Use `SELECT ... FOR UPDATE` (pessimistic locking) inside a `prisma.$transaction`:

```typescript
await prisma.$transaction(async (tx) => {
  const product = await tx.$queryRaw<
    { id: string; stock: number; stock_min: number }[]
  >`SELECT id, stock, stock_min FROM products WHERE id = $1::uuid FOR UPDATE`;
  // ... mutation logic
});
```

This locks the row until the transaction commits, serializing concurrent accesses.

## Alternatives Considered

### Optimistic concurrency with version column

Add a `version` field and retry on conflict — better under low contention, but SALIDA writes collide frequently and retries inflate tail latency more than a single row lock.

### SERIALIZABLE isolation level

PostgreSQL serializable transactions abort on serialization failure and require retry — broader locks than `FOR UPDATE` and worse tail latency in this access pattern.

### Application-level distributed lock (Redis/SQS)

External coordinator would solve contention but adds infra and operational overhead unjustified at MVP-scale concurrency.

## Consequences

### Positive

- **Consistency**: Concurrent SALIDAs are serialized; stock never goes negative.
- **Deadlock avoidance**: Always lock in consistent order (product → stock_movement).

### Negative

- **Performance**: Row lock adds latency under high concurrency.
- **Capacity planning**: With reserved concurrency = 1 per Lambda, deadlocks are unlikely.

## References

- Risk: RISK-002
- Design: `design.md` §6.2

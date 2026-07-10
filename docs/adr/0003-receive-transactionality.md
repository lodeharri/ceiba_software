# ADR-0003: Receive Flow Transactionality

## Status

Accepted

## Context

When receiving an order, three things must happen atomically:

1. Order status changes to `RECIBIDA`
2. Product stock increases
3. Active alert (if any) closes

If any step fails, all must roll back. The risk review (RISK-001) requires this atomicity.

## Decision

The `ReceiveOrderUseCase` executes a four-step atomic flow inside `prisma.$transaction`:

```
1. order-repository.txUpdate(id, status='RECIBIDA')
2. productStockGate.txIncrementStock(tx, productId, quantity, reason, userId)
3. alertCloserPort.txCloseIfOpenAndAboveMin(tx, productId, newStock, stockMin)
4. return { order, stockAfter, closedAlertId? }
```

If step 2 or 3 throws, the entire transaction rolls back — the order stays `APROBADA`, no stock movement is created.

## Consequences

### Positive

- **Atomic**: All three state changes succeed or none do.
- **No reconciliation needed**: Alert state is always consistent with stock.

### Negative

- **Complexity**: The transaction spans three tables.
- **Performance**: Longer transaction duration under load.

## References

- Risk: RISK-001
- Related ADR: ADR-1 (Direct Ports)

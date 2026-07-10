# ADR-0001: Cross-Bounded Context Receive via Direct Ports

## Status

Accepted

## Context

The orders bounded context needs to integrate with inventory and alerts bounded contexts when receiving an order. The original design explored using an in-process event bus (Domain Events) for this integration.

The risk review identified RISK-001: the in-process event bus approach has a critical flaw — if the event handler (which opens/closes alerts) throws after the database transaction commits, the event is lost and the alert state becomes inconsistent with the order state.

## Decision

Replace the in-process event bus with **direct port calls** inside the same database transaction:

1. `ProductStockGate.txIncrementStock(tx, productId, quantity, ...)` — port interface
2. `AlertCloserPort.txCloseIfOpenAndAboveMin(tx, productId, newStock, stockMin)` — port interface

Both ports are called **inside** `prisma.$transaction()` in the `ReceiveOrderUseCase`, ensuring atomicity.

## Consequences

### Positive

- **Atomicity**: If any step fails, the entire transaction rolls back — no partial state.
- **Traceability**: Direct calls are easier to debug than events.
- **No event bus dependency**: Removes infrastructure complexity.

### Negative

- **Tight coupling**: The orders BC directly depends on inventory and alerts ports.
- **Trade-off**: We chose consistency over the decoupling benefits of events.

## References

- Risk: RISK-001
- Related ADR: ADR-3 (Receive Transactionality)

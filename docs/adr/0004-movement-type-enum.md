# ADR-0004: Movement Type Enum

## Status

Accepted

## Context

Stock movements have two types: increases (ENTRADA) and decreases (SALIDA). The sign of the quantity determines the direction.

The original design considered a separate `direction` field. The current design uses a `type` enum that **determines** the sign of the quantity.

## Decision

```typescript
enum MovementType {
  ENTRADA = 'ENTRADA', // Adds to stock
  SALIDA = 'SALIDA', // Subtracts from stock
}
```

The VO `StockMovement.applyTo(currentStock)` returns:

- `currentStock + quantity` for ENTRADA
- `currentStock - quantity` for SALIDA

Quantity is always positive. The type determines direction.

## Consequences

### Positive

- **Single source of truth**: Sign is never ambiguous.
- **Validation simplicity**: Quantity > 0 is the only invariant.

### Negative

- None significant.

## References

- Design: `design.md` §6.1
- Spec: `inventory/spec.md`

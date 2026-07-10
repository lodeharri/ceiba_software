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

## Alternatives Considered

### Signed integer quantity field

Single `quantity` column with implicit sign (+/−) — simpler schema but lets sign and type disagree on bad writes, and removes the `quantity > 0` invariant from the DB.

### Separate direction + positive magnitude columns

`direction: IN|OUT` plus a positive `quantity` — duplicates information already encoded by `MovementType` and forces a cross-column invariant.

### Boolean `isIncrease` flag with magnitude

Even more duplicative and harder to read in queries — rejected as noisier than a two-value enum.

## Consequences

### Positive

- **Single source of truth**: Sign is never ambiguous.
- **Validation simplicity**: Quantity > 0 is the only invariant.

### Negative

- None significant.

## References

- Design: `design.md` §6.1
- Spec: `inventory/spec.md`

-- Migration: add_stock_movements_stock_after
-- Adds the denormalized `stock_after` column to `stock_movements`.
-- Matches the shared Zod contract in
-- `packages/shared/src/schemas/inventory/movement.ts` (`stockAfter` is
-- required on the read model so list views do not need to walk the
-- ledger to compute it). Persisted at insert time by
-- `StockMutationService.record()` and `PrismaProductStockGate.txIncrementStock()`.
--
-- Backfill strategy: existing rows get `stock_after = 0`. The list view
-- surfaces historical movements; legacy rows predating this migration
-- have no reliable ledger to backfill from, so the UI shows `0` for them
-- rather than a misleading synthetic value. New rows are persisted with
-- the correct denormalized value.
--
-- Additive only — no DROP COLUMN or ALTER … DROP (proposal §11.3
-- rollback contract).

BEGIN;

ALTER TABLE stock_movements
  ADD COLUMN stock_after INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN stock_movements.stock_after IS
  'Product stock immediately after this movement was applied. Denormalized at insert time.';

COMMIT;

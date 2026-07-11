-- Migration: align_purchase_orders_status_enum
-- Root cause: the PR 2c hand-written migration (20260710000000_add_purchase_orders)
-- created the `status` column as TEXT with a CHECK constraint instead of the
-- proper Postgres ENUM type. Prisma's generated client writes the column as
-- `"OrderStatus"` (the schema.prisma enum name), but that type was never
-- created in the database — causing 500 / "type public.OrderStatus does not
-- exist" at runtime.
--
-- Fix:
--   1. CREATE TYPE "OrderStatus" AS ENUM (...)   — matches schema.prisma
--   2. DROP the legacy CHECK constraint (redundant once the column is ENUM;
--      keeping it would cause "operator does not exist: OrderStatus = text"
--      because the constraint still compares with text literals).
--   3. ALTER COLUMN status TYPE "OrderStatus"    — all existing values are
--      in the enum set, so the USING expression is safe.
--
-- NOTE: no BEGIN/COMMIT — Prisma wraps each migration in its own transaction.
-- The only DROP is the redundant CHECK constraint which is replaced 1-for-1
-- by the ENUM type constraint; no data is removed.

CREATE TYPE "OrderStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'RECIBIDA');

-- Drop the legacy CHECK before altering the column type.
-- Postgres does NOT auto-drop CHECK constraints on ALTER COLUMN TYPE.
-- Without this the ALTER fails with: operator does not exist: "OrderStatus" = text
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

-- The DEFAULT 'PENDIENTE' text literal cannot auto-cast to ENUM.
-- Drop it before the type change, re-add as an explicit cast after.
ALTER TABLE purchase_orders
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE purchase_orders
  ALTER COLUMN status TYPE "OrderStatus"
  USING (status)::text::"OrderStatus";

ALTER TABLE purchase_orders
  ALTER COLUMN status SET DEFAULT 'PENDIENTE'::"OrderStatus";

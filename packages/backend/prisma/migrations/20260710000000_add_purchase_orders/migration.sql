-- Migration: add_purchase_orders (PR 2c)
-- Creates the purchase_orders table for the Orders BC.
-- Additive only — no DROP COLUMN or ALTER … DROP (proposal §11.3 rollback contract).

BEGIN;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id       UUID        NOT NULL,
  quantity         INTEGER     NOT NULL CHECK (quantity > 0),
  status           TEXT        NOT NULL DEFAULT 'PENDIENTE'
                          CHECK (status IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'RECIBIDA')),
  supplier_snapshot VARCHAR(120) NOT NULL,
  from_alert_id    UUID,
  reason           VARCHAR(500),
  created_by       UUID        NOT NULL,
  received_at      TIMESTAMPTZ(6),
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE purchase_orders IS 'Orders BC — PurchaseOrder aggregate (PR 2c)';
COMMENT ON COLUMN purchase_orders.supplier_snapshot IS 'Write-once snapshot of Product.supplier at creation (Q-P3)';
COMMENT ON COLUMN purchase_orders.from_alert_id IS 'Optional reference to the ACTIVA alert that triggered this order (BR-D4)';

-- Index: product list ordered by creation
CREATE INDEX IF NOT EXISTS purchase_orders_product_created_idx
  ON purchase_orders (product_id, created_at DESC);

-- Index: status list for filtered GET /orders
CREATE INDEX IF NOT EXISTS purchase_orders_status_created_idx
  ON purchase_orders (status, created_at DESC);

COMMIT;

-- PR 2b: Inventory BC + Alerts BC
-- Adds stock_movements (append-only, BR-6) and alerts (BR-4 partial unique index).

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRADA', 'SALIDA');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVA', 'RESUELTA');

-- CreateTable: stock_movements (inventory BC, append-only per BR-6)
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(280) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: alerts (alerts BC, BR-4 partial unique index)
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVA',
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- BR-4: at most one ACTIVA alert per productId (partial unique index)
CREATE UNIQUE INDEX "alerts_one_active_per_product" ON "alerts"("product_id") WHERE status = 'ACTIVA';

-- Indexes for stock_movements (append-only, read by product + createdAt DESC)
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at" DESC);

-- Indexes for alerts (list by status + createdAt DESC; filter by productId)
CREATE INDEX "alerts_status_created_at_idx" ON "alerts"("status", "created_at" DESC);
CREATE INDEX "alerts_product_id_idx" ON "alerts"("product_id");

-- PR 2a initial migration (handwritten — `prisma migrate dev` requires
-- a live DB; ships as a 0_init/ directory the migrations Lambda applies
-- with `prisma migrate deploy`).
--
-- Scope: users, categories, products, login_attempts, idempotency_keys.
-- stock_movements / alerts / purchase_orders land in PR 2b/2c via additive
-- migrations (proposal §11.3 rollback contract — no DROP COLUMN / ALTER TABLE … DROP).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "users" (
  "id"            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"         TEXT        NOT NULL UNIQUE,
  "username"      TEXT        NOT NULL UNIQUE,
  "password_hash" TEXT        NOT NULL,
  "role"          TEXT        NOT NULL DEFAULT 'admin',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "users_username_idx" ON "users" ("username");

CREATE TABLE "categories" (
  "id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       TEXT        NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "products" (
  "id"          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  "sku"         TEXT           NOT NULL UNIQUE,
  "name"        TEXT           NOT NULL,
  "category_id" UUID           NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "price"       DECIMAL(12, 0) NOT NULL,
  "stock"       INT            NOT NULL DEFAULT 0 CHECK (stock >= 0),
  "stock_min"   INT            NOT NULL CHECK (stock_min > 0),
  "supplier"    TEXT           NOT NULL,
  "created_at"  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX "products_sku_idx"         ON "products" ("sku");
CREATE INDEX "products_category_idx"    ON "products" ("category_id");
CREATE INDEX "products_supplier_idx"    ON "products" ("supplier");
CREATE INDEX "products_stock_range_idx" ON "products" ("stock");

CREATE TABLE "login_attempts" (
  "id"           BIGSERIAL    PRIMARY KEY,
  "ip"           INET         NOT NULL,
  "username"     TEXT         NOT NULL,
  "success"      BOOLEAN      NOT NULL,
  "attempted_at" TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Partial index used by the rate limiter's
-- `WHERE success = false AND attempted_at > now() - INTERVAL '15 min'`
-- query path. Per design.md §4.6 + RISK-003.
CREATE INDEX "login_attempts_ip_username_failure_idx"
  ON "login_attempts" ("ip", "username", "attempted_at" DESC)
  WHERE "success" = false;

CREATE TABLE "idempotency_keys" (
  "key"             TEXT        PRIMARY KEY,
  "user_id"         UUID        NOT NULL,
  "request_hash"    TEXT        NOT NULL,
  "response_status" INTEGER     NOT NULL,
  "response_body"   JSONB       NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idempotency_keys_user_created_idx" ON "idempotency_keys" ("user_id", "created_at");

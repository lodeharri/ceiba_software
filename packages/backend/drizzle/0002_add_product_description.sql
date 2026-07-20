-- Idempotent migration: add description column to products table
-- Used in semantic search embedding text (name + description + supplier)
-- Uses IF NOT EXISTS for idempotency

ALTER TABLE products ADD COLUMN IF NOT EXISTS description text;


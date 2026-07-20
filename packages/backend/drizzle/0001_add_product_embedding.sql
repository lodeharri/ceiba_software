-- 0001_add_product_embedding.sql
-- Adds nullable vector(768) embedding column + HNSW index to products table.
-- Idempotent: safe to re-run on a populated table.
--
-- pgvector extension is pre-enabled via:
--   docker/postgres-init/01-pgvector.sql  (local development)
--   RDS default_extensions parameter group (AWS)
-- No CREATE EXTENSION here to keep migration portable.

-- Add nullable vector(768) column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(768);

-- HNSW index for cosine similarity search
-- IF NOT EXISTS makes this idempotent
CREATE INDEX IF NOT EXISTS products_embedding_hnsw
  ON products USING hnsw (embedding vector_cosine_ops);

-- PostgreSQL init script for the MercadoExpress local development stack.
--
-- Mounted into the postgres container by docker-compose.dev.yml at:
--   ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
--
-- Runs ONLY when the named `pgdata` volume is empty (i.e. first boot, or
-- after `docker compose down -v`). Subsequent boots skip this script
-- because the data directory already exists. That is why every statement
-- here MUST be idempotent (`IF NOT EXISTS` / `OR REPLACE`).

-- pgvector: embeddings used by the AI adapter ports (EmbeddingPort, ChatPort).
-- Required by Prisma migrations that declare a `vector` column type.
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto: gen_random_uuid() used by Prisma `@default(uuid())` columns
-- across all bounded contexts (products, inventory, alerts, orders, users).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
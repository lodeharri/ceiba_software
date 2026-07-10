#!/bin/sh
set -e

# Crea .env.dev y .env.dev.local si no existen
[ -f .env.dev ] || cp .env.dev.example .env.dev
[ -f .env.dev.local ] || cp .env.dev.example .env.dev.local

# Crea .docker-shared (donde el deployer escribe .api-url)
mkdir -p .docker-shared

# Compose up con --env-file explícito (porque top-level env_file no funciona en Compose v2.40)
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d

echo ""
echo "✅ Dev stack levantando. Espera ~3min para que el deployer termine."
echo "URLs:"
echo "  Frontend:    http://localhost:5173"
echo "  LocalStack:  http://localhost:4566/_localstack/health"
echo "  PostgreSQL:  localhost:5432 (user: ceiba, pass: ceiba_dev, db: mercadoexpress)"
echo ""
echo "Logs: docker compose -f docker-compose.dev.yml logs -f deployer"
echo "Reset: scripts/dev-down.sh"

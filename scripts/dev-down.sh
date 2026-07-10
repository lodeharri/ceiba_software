#!/bin/sh
# By default, preserves volumes (DB data). Use scripts/dev-down.sh -v to wipe.
docker compose --env-file .env.dev -f docker-compose.dev.yml down "$@"
echo ""
echo "💡 Volumes preserved. For full reset use: scripts/dev-down.sh -v"

#!/bin/sh
docker compose --env-file .env.dev -f docker-compose.dev.yml down -v "$@"

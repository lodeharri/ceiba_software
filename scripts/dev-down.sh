#!/usr/bin/env bash
# scripts/dev-down.sh
# Stops the local dev stack. Volumes are PRESERVED by default so PostgreSQL
# data and LocalStack state persist across sessions.
#
# Usage:
#   ./dev-down.sh          # stops services, keeps all volumes (default)
#   ./dev-down.sh --clean  # stops services AND removes named volumes
set -Eeuo pipefail

COMPOSE_FILE="docker-compose.dev.yml"

usage() {
  cat <<EOF
Usage: $0 [--clean]

Stops the local dev stack.

  (no args)  stop services, preserve volumes (default — data is kept)
  --clean    stop services AND remove named volumes (full reset)
EOF
}

clean=0
if [[ $# -gt 0 ]]; then
  case "$1" in
    --clean|-c)
      clean=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
fi

echo "Stopping local dev stack..."

if ! docker compose -f "${COMPOSE_FILE}" ps --quiet 2>/dev/null | grep -q .; then
  echo "No running services found in ${COMPOSE_FILE}."
  exit 0
fi

if (( clean )); then
  echo "  Removing named volumes (full reset — data will be lost)..."
  docker compose -f "${COMPOSE_FILE}" down -v
  echo "Done. Volumes removed."
else
  echo "  Stopping services (volumes preserved — data is kept)..."
  docker compose -f "${COMPOSE_FILE}" down
  echo "Done. Run '$0 --clean' to remove volumes."
fi

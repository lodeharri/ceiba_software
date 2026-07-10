#!/bin/bash
# Frontend entrypoint - reads API URL from shared file or env
set -e

# Si existe /shared/.api-url (del deployer), úsalo
if [ -f "${API_URL_FILE:-/shared/.api-url}" ]; then
  VITE_API_BASE_URL=$(cat "${API_URL_FILE:-/shared/.api-url}" | tr -d '\n')
  echo "✅ Using API URL from ${API_URL_FILE}: ${VITE_API_BASE_URL}"
fi

export VITE_API_BASE_URL
exec pnpm dev --host "${VITE_HOST:-0.0.0.0}" --port "${FRONTEND_PORT:-5173}"

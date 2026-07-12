#!/bin/sh
# docker/frontend/entrypoint.sh
# Frontend container startup: waits for the deployer to write the API URL file,
# exports it as VITE_API_BASE_URL, then starts the dev server.
set -eu

: "${API_URL_FILE:?API_URL_FILE is required}"
: "${FRONTEND_PORT:?FRONTEND_PORT is required}"
: "${VITE_HOST:?VITE_HOST is required}"

wait_timeout="${API_URL_WAIT_TIMEOUT_SECONDS:-300}"
elapsed=0

echo "Waiting for API URL file: ${API_URL_FILE}"
while [ ! -s "${API_URL_FILE}" ]; do
  if [ "$elapsed" -ge "$wait_timeout" ]; then
    echo "ERROR: API URL file was not written within ${wait_timeout}s: ${API_URL_FILE}" >&2
    exit 1
  fi
  echo "  API URL file not present yet (${elapsed}s elapsed). Waiting..."
  sleep 2
  elapsed=$((elapsed + 2))
done

VITE_API_BASE_URL="$(cat "${API_URL_FILE}")"
export VITE_API_BASE_URL

if [ -z "${VITE_API_BASE_URL}" ]; then
  echo "ERROR: API URL file is empty: ${API_URL_FILE}" >&2
  exit 1
fi

echo "Starting Vite dev server with VITE_API_BASE_URL=${VITE_API_BASE_URL}"
echo "  VITE_HOST=${VITE_HOST}"
echo "  FRONTEND_PORT=${FRONTEND_PORT}"
exec pnpm dev --host "${VITE_HOST}" --port "${FRONTEND_PORT}"

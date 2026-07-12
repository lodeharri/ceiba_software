#!/usr/bin/env bash
# wait-for-services.sh
# Polls PostgreSQL and LocalStack readiness until both are healthy or timeout.
# This is the readiness gate BEFORE cdk deploy runs.
set -Eeuo pipefail

poll_interval="${SERVICE_WAIT_INTERVAL_SECONDS:-2}"
max_seconds="${SERVICE_WAIT_TIMEOUT_SECONDS:-300}"
deadline=$((SECONDS + max_seconds))

wait_for_postgres() {
  local host="${POSTGRES_HOST:-postgres}"
  local port="${POSTGRES_PORT:-5432}"
  local user="${POSTGRES_USER:-ceiba}"
  local db="${POSTGRES_DB:-mercadoexpress}"

  echo "Waiting for PostgreSQL at ${host}:${port}..."
  until pg_isready -h "${host}" -p "${port}" -U "${user}" -d "${db}" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "ERROR: PostgreSQL did not become ready within ${max_seconds}s." >&2
      exit 1
    fi
    echo "  PostgreSQL not ready yet (${SECONDS}s elapsed). Retrying in ${poll_interval}s..."
    sleep "$poll_interval"
  done
  echo "PostgreSQL is ready."
}

wait_for_localstack() {
  local host="${LOCALSTACK_HOST:-localstack}"
  local port="${LOCALSTACK_PORT:-4566}"
  local health_url="http://${host}:${port}/_localstack/health"
  local required="${LOCALSTACK_REQUIRED_SERVICES:-lambda,apigateway,secretsmanager,ssm,iam,cloudformation,sts}"

  echo "Waiting for LocalStack at ${host}:${port}..."
  until curl -fsS "${health_url}" -o /tmp/localstack-health.json \
    && jq -e --arg csv "${required}" '
      ($csv | split(",")) as $requiredServices |
      all($requiredServices[]; . as $svc | ($requiredServices | index($svc) as $idx | true) and (.services[$svc] == "available" or .services[$svc] == "running"))
    ' /tmp/localstack-health.json >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "ERROR: LocalStack services did not become ready within ${max_seconds}s." >&2
      cat /tmp/localstack-health.json >&2 2>/dev/null || true
      exit 1
    fi
    echo "  LocalStack not fully ready (${SECONDS}s elapsed). Retrying in ${poll_interval}s..."
    sleep "$poll_interval"
  done
  echo "LocalStack is ready."
}

wait_for_postgres
wait_for_localstack
echo "All services are ready."

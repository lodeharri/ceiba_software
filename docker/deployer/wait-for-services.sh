#!/bin/bash
# Wait for LocalStack and PostgreSQL to be ready
set -e

echo "⏳ Waiting for LocalStack on ${LOCALSTACK_HOST}:${LOCALSTACK_PORT}..."
timeout 300 bash -c "until curl -sf http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}/_localstack/health > /dev/null; do sleep 2; done"
echo "✅ LocalStack ready"

echo "⏳ Waiting for PostgreSQL..."
timeout 60 bash -c "until pg_isready -h postgres -p \${POSTGRES_PORT:-5432} -U \${POSTGRES_USER:-ceiba}; do sleep 2; done"
echo "✅ PostgreSQL ready"

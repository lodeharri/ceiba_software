#!/bin/bash
set -e

echo "🔧 Resolved env vars:"
echo "  STAGE=${STAGE:-localstack}"
echo "  AWS_ENDPOINT_URL=${AWS_ENDPOINT_URL}"
DB_HOST=$(echo "${DATABASE_URL}" | sed -E 's|.*@([^/]+).*|\1|')
echo "  DB_HOST=${DB_HOST}"

/docker/wait-for-services.sh

cd /app/packages/infra

echo "🚀 Deploying CDK stacks to LocalStack..."
AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL}" \
  STAGE="${STAGE:-localstack}" \
  DATABASE_URL="${DATABASE_URL}" \
  pnpm exec cdk deploy \
  --context stage="${STAGE:-localstack}" \
  --context skipRds=true \
  --context skipCloudFront=true \
  --require-approval never \
  --outputs-file="${CDK_OUTPUTS_FILE:-/shared/cdk-outputs.json}" \
  MercadoExpress-localstack-Api \
  MercadoExpress-localstack-Observability \
  2>&1 | tee "${SHARED_DATA_DIR:-/shared}/deploy.log"
DEPLOY_EXIT=${PIPESTATUS[0]}
if [ $DEPLOY_EXIT -ne 0 ]; then
  echo "❌ CDK deploy failed with exit $DEPLOY_EXIT"
  exit 1
fi

# Extraer API URL del output
API_URL=$(cat "${CDK_OUTPUTS_FILE:-/shared/cdk-outputs.json}" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    api_key = [k for k in data.keys() if 'Api' in k][0]
    print(data[api_key].get('ApiUrl', 'http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}'))
except Exception as e:
    print(f'http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}')
" 2>/dev/null)

mkdir -p "${SHARED_DATA_DIR:-/shared}"
echo "${API_URL}" >"${API_URL_FILE:-${SHARED_DATA_DIR:-/shared}/.api-url}"
echo "✅ API URL: ${API_URL}"

# Tail logs forever
tail -f /dev/null

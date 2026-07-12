#!/usr/bin/env bash
# docker/deployer/entrypoint.sh
# Deployer container startup: validates config, waits for services,
# runs cdk deploy against LocalStack, and writes the API URL for the frontend.
set -Eeuo pipefail

required_vars=(
  STAGE AWS_ENDPOINT_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
  DATABASE_URL JWT_SECRET ADMIN_USERNAME ADMIN_EMAIL ADMIN_PASSWORD FRONTEND_ORIGIN
  LOCALSTACK_HOST LOCALSTACK_PORT API_GATEWAY_HOST_EXTERNAL API_GATEWAY_PORT
  API_URL_FILE CDK_OUTPUTS_FILE
)

# Validate required env vars — exit non-zero on first missing.
for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required env var ${name} is missing or empty. Check .env.dev." >&2
    exit 1
  fi
done

mask_value() {
  local name="$1"
  local value="$2"
  case "${name}" in
    *PASSWORD*|*SECRET*|*TOKEN*|DATABASE_URL) printf '<masked>' ;;
    *) printf '%s' "${value}" ;;
  esac
}

echo "=== Resolved local development configuration ==="
for name in STAGE AWS_ENDPOINT_URL AWS_DEFAULT_REGION LOCALSTACK_HOST LOCALSTACK_PORT \
            API_GATEWAY_HOST_EXTERNAL API_GATEWAY_PORT FRONTEND_ORIGIN \
            POSTGRES_HOST POSTGRES_PORT FRONTEND_PORT; do
  [[ -n "${!name:-}" ]] || continue
  printf '  %-30s = %s\n' "${name}" "$(mask_value "${name}" "${!name}")"
done
echo "================================================"

echo "Waiting for dependent services..."
/usr/local/bin/wait-for-services.sh

cd /app/packages/infra

mkdir -p "$(dirname "${CDK_OUTPUTS_FILE}")" "$(dirname "${API_URL_FILE}")"
rm -f "${CDK_OUTPUTS_FILE}" "${API_URL_FILE}"

echo "Deploying CDK stacks to LocalStack (stage=${STAGE})..."
timeout "${CDK_DEPLOY_TIMEOUT_SECONDS:-300}" \
  pnpm exec cdk deploy \
    --context "stage=${STAGE}" \
    --context skipRds=true \
    --context skipCloudFront=true \
    --require-approval never \
    --outputs-file "${CDK_OUTPUTS_FILE}"

# cdk deploy exits non-zero on any failure — no || guard needed (pipefail above).
# Capture exit code explicitly to ensure we never silently swallow it.
deploy_status=$?

if (( deploy_status != 0 )); then
  echo "ERROR: cdk deploy failed with exit code ${deploy_status}." >&2
  echo "Check LocalStack logs and CDK output above." >&2
  exit "${deploy_status}"
fi

# Parse API URL from CDK outputs using jq (NOT python3).
# Accept HttpApiUrl, ApiUrl, or apiUrl as the output key name.
api_url="$(
  jq -er '
    to_entries[]
    | select(.key | test("^HttpApiUrl$|^ApiUrl$|^apiUrl$"; "i"))
    | .value
    | if type == "object" then .HttpApiUrl // .ApiUrl // .apiUrl // empty else . end
    | if type == "string" then . else empty end
  ' "${CDK_OUTPUTS_FILE}" 2>/dev/null
)"

if [[ -z "${api_url}" ]]; then
  echo "ERROR: CDK outputs did not contain HttpApiUrl or ApiUrl in an Api stack output." >&2
  echo "CDK outputs:" >&2
  jq '.' "${CDK_OUTPUTS_FILE}" >&2 || true
  exit 1
fi

# If LocalStack emits a container-internal host, rewrite to the configured external host.
api_url="${api_url//${LOCALSTACK_HOST}:${LOCALSTACK_PORT}/${API_GATEWAY_HOST_EXTERNAL}:${API_GATEWAY_PORT}}"

# Atomic write to avoid a partially-written file if the container is killed mid-write.
printf '%s' "${api_url}" > "${API_URL_FILE}.tmp"
mv "${API_URL_FILE}.tmp" "${API_URL_FILE}"

echo "API URL written to ${API_URL_FILE}: ${api_url}"
echo "Deployer is healthy. Keeping container alive for log access."
tail -f /dev/null

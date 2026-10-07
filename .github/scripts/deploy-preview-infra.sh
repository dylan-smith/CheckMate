#!/usr/bin/env bash
# Deploys a pull request's preview infrastructure and writes what the later deploy-preview steps need to
# $GITHUB_OUTPUT: app-service-url, api-client-id, sql-server-fqdn, storage-account-name and frontend-origin.
#
# First the resources every preview shares (preview-shared.bicep), from the PR's base branch checked out in
# BASE_DIR, so a PR can't change them for every other preview; the PR's own copy is only used while the base
# branch doesn't have the template yet. Then the PR's own resources (preview.bicep), keeping the database's
# current tags, which a deployment would otherwise replace.
#
# Each deployment has a fixed name per PR, so it first waits for one still running (from a job that timed out,
# say). They're retried in case two PRs' runs update the shared resources at the same moment.
# Requires PREVIEW_RESOURCE_GROUP, PR_NUMBER, PREVIEW_PR_NUMBER (read by infra/preview.bicepparam) and BASE_DIR,
# and runs from the repository root.
set -euo pipefail

outputs="${RUNNER_TEMP}/preview-outputs.json"

# Usage: deploy <deployment name> <template> <parameters file>; the outputs go to $outputs.
deploy() {
  bash .github/scripts/wait-for-deployment.sh "${PREVIEW_RESOURCE_GROUP}" "$1"
  for attempt in 1 2 3; do
    if az deployment group create \
      --resource-group "${PREVIEW_RESOURCE_GROUP}" \
      --name "$1" \
      --template-file "$2" \
      --parameters "$3" \
      --only-show-errors \
      --query properties.outputs \
      --output json >"${outputs}"; then
      return 0
    fi
    if [ "${attempt}" -eq 3 ]; then
      echo "::error::Deploying $2 failed"
      exit 1
    fi
    echo "Deployment attempt ${attempt} failed; retrying in 30 seconds"
    sleep 30
  done
}

shared_dir="${BASE_DIR}/infra"
if [ ! -f "${shared_dir}/preview-shared.bicep" ]; then
  echo "::notice::The base branch has no preview-shared.bicep yet, so this PR's copy is deployed"
  shared_dir=infra
fi
deploy "preview-shared-pr-${PR_NUMBER}" "${shared_dir}/preview-shared.bicep" "${shared_dir}/preview-shared.bicepparam"

# Read just before the deployment, after the migrations check, which may have deleted the database.
PREVIEW_DATABASE_TAGS="$(az resource list \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --query "[?tags.\"pr-number\" == '${PR_NUMBER}' && type == 'Microsoft.Sql/servers/databases'] | [0].tags" \
  --output json)"
if [ -z "${PREVIEW_DATABASE_TAGS}" ] || [ "${PREVIEW_DATABASE_TAGS}" = "null" ]; then
  PREVIEW_DATABASE_TAGS='{}'
fi
export PREVIEW_DATABASE_TAGS
deploy "preview-pr-${PR_NUMBER}" infra/preview.bicep infra/preview.bicepparam

output() {
  jq -r ".$1.value" "${outputs}"
}

# Azure SQL derives an application's SID from its client ID (see preview-db-user.sql), which the Bicep identity
# output doesn't include. Resource Manager exposes it without a Microsoft Entra ID lookup.
client_id="$(az rest \
  --method get \
  --url "https://management.azure.com$(output appServiceId)/providers/Microsoft.ManagedIdentity/identities/default?api-version=2023-01-31" \
  --query properties.clientId \
  --output tsv)"
if [ -z "${client_id}" ]; then
  echo "::error::Couldn't read the client ID of the preview web app's managed identity"
  exit 1
fi

frontend_endpoint="$(output frontendWebEndpoint)"
{
  echo "app-service-url=$(output appServiceUrl)"
  echo "api-client-id=${client_id}"
  echo "sql-server-fqdn=$(output sqlServerFqdn)"
  echo "storage-account-name=$(output storageAccountName)"
  # The browser sends the origin without a trailing slash.
  echo "frontend-origin=${frontend_endpoint%/}"
} >>"${GITHUB_OUTPUT}"

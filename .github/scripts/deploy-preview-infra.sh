#!/usr/bin/env bash
# Deploys a pull request's preview infrastructure (infra/preview.bicep) and writes what the later deploy-preview
# steps need to $GITHUB_OUTPUT: app-service-url, api-client-id, sql-server-fqdn, storage-account-name and
# frontend-origin.
#
# The deployment has a fixed name per PR, so it first waits for one still running (from a job that timed out,
# say). It's retried in case two PRs' runs update the shared App Service plan or SQL server at the same moment.
# Requires PREVIEW_RESOURCE_GROUP, PR_NUMBER and PREVIEW_PR_NUMBER (read by infra/preview.bicepparam), and runs
# from the repository root.
set -euo pipefail

deployment="preview-pr-${PR_NUMBER}"
outputs="${RUNNER_TEMP}/preview-outputs.json"

bash .github/scripts/wait-for-deployment.sh "${PREVIEW_RESOURCE_GROUP}" "${deployment}"

for attempt in 1 2 3; do
  if az deployment group create \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --name "${deployment}" \
    --template-file infra/preview.bicep \
    --parameters infra/preview.bicepparam \
    --only-show-errors \
    --query properties.outputs \
    --output json >"${outputs}"; then
    break
  fi
  if [ "${attempt}" -eq 3 ]; then
    echo "::error::The preview infrastructure deployment failed"
    exit 1
  fi
  echo "Deployment attempt ${attempt} failed; retrying in 30 seconds"
  sleep 30
done

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

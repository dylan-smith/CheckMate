#!/usr/bin/env bash
# Reads the backend's Application Insights connection string from its App Service app setting and writes it to
# $GITHUB_OUTPUT as connection-string. Bicep sets the setting from the monitoring module, so the frontend
# reports to the same Application Insights resource as the backend without a copy in a repository variable.
# The connection string isn't a secret (it ships in the public bundle).
# Requires AZURE_RESOURCE_GROUP and AZURE_BACKEND_APP_NAME.
set -euo pipefail

connection_string="$(az webapp config appsettings list \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${AZURE_BACKEND_APP_NAME}" \
  --query "[?name=='APPLICATIONINSIGHTS_CONNECTION_STRING'].value | [0]" \
  --output tsv)"
if [ -z "${connection_string}" ]; then
  echo "::error::APPLICATIONINSIGHTS_CONNECTION_STRING isn't set on ${AZURE_BACKEND_APP_NAME}."
  exit 1
fi
echo "connection-string=${connection_string}" >>"$GITHUB_OUTPUT"

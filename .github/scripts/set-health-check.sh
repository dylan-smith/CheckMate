#!/usr/bin/env bash
# Turns the /health availability test (checkmate-api-health in infra/modules/alerts.bicep) off or on, so a
# deploy's planned pause doesn't count as failed runs and fire the API down alert. The template deploys the test
# enabled, so if a run stops before turning it back on, the next deployment does.
#
# Usage: set-health-check.sh true|false
# Requires AZURE_RESOURCE_GROUP.
set -euo pipefail

enabled="$1"
if [ "${enabled}" != "true" ] && [ "${enabled}" != "false" ]; then
  echo "::error::Expected true or false, got '${enabled}'"
  exit 1
fi

echo "Setting the API health availability test Enabled=${enabled}"
az resource update \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name checkmate-api-health \
  --resource-type Microsoft.Insights/webtests \
  --api-version 2022-06-15 \
  --set "properties.Enabled=${enabled}" \
  --only-show-errors \
  --output none

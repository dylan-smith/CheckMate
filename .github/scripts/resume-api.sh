#!/usr/bin/env bash
# Resumes the API by removing the deploy-pause-* access restriction rules that pause-api.sh added. Only those
# rules are removed, and pause-api.sh may have stopped before adding both.
#
# Requires AZURE_RESOURCE_GROUP and AZURE_BACKEND_APP_NAME.
set -euo pipefail

for rule in deploy-pause-ipv4 deploy-pause-ipv6; do
  if [ "$(az webapp config access-restriction show \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_BACKEND_APP_NAME}" \
    --query "length(ipSecurityRestrictions[?name=='${rule}'])" \
    --output tsv)" != "0" ]; then
    az webapp config access-restriction remove \
      --resource-group "${AZURE_RESOURCE_GROUP}" \
      --name "${AZURE_BACKEND_APP_NAME}" \
      --rule-name "${rule}" \
      --only-show-errors \
      --output none
  fi
done

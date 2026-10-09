#!/usr/bin/env bash
# Writes the origin the frontend is served on to $GITHUB_OUTPUT as frontend-origin: the storage account's custom
# domain when it has one (Bicep's frontendCustomDomain), otherwise its static website endpoint without the trailing
# slash. Requires AZURE_STORAGE_ACCOUNT_NAME.
set -euo pipefail

read -r custom_domain web_endpoint < <(az storage account show \
  --name "${AZURE_STORAGE_ACCOUNT_NAME}" \
  --query '[customDomain.name || `-`, primaryEndpoints.web]' \
  --output tsv | paste -sd ' ')

if [ "${custom_domain}" != '-' ]; then
  origin="https://${custom_domain}"
else
  origin="${web_endpoint%/}"
fi
echo "frontend-origin=${origin}" >>"$GITHUB_OUTPUT"

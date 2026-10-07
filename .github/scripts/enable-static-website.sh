#!/usr/bin/env bash
# Turns on static website hosting for a storage account, serving index.html for every path the site doesn't
# have (so the frontend's client-side routes work). This is a data-plane setting that ARM templates can't
# manage. Data-plane calls can be refused for a short while after an account is created, even with the role
# already granted, so it's retried.
# Requires AZURE_STORAGE_ACCOUNT_NAME.
set -euo pipefail

for attempt in $(seq 1 5); do
  if az storage blob service-properties update \
    --account-name "${AZURE_STORAGE_ACCOUNT_NAME}" \
    --auth-mode login \
    --static-website \
    --index-document index.html \
    --404-document index.html \
    --only-show-errors \
    --output none; then
    exit 0
  fi
  if [ "${attempt}" -eq 5 ]; then
    echo "::error::Couldn't enable static website hosting on ${AZURE_STORAGE_ACCOUNT_NAME}"
    exit 1
  fi
  echo "Attempt ${attempt} failed; retrying in 15 seconds"
  sleep 15
done

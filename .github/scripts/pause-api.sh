#!/usr/bin/env bash
# Pauses the API so no requests reach it while the database is backed up and migrated. Adds deploy-pause-*
# access restriction rules that deny all public traffic at priority 1, ahead of any other rule, and leaves the
# deployment (SCM) site reachable. The API has no background work, so without requests it doesn't touch the
# database. The rules are the pause marker: resume-api.sh removes just them, so the site's own access
# restrictions are left as they were.
#
# Outputs was-live=true when the API wasn't already paused.
# Requires AZURE_RESOURCE_GROUP, AZURE_BACKEND_APP_NAME and AZURE_BACKEND_URL.
set -euo pipefail

# An earlier run can leave the API paused after its migrations started (see "Report API left paused" in ci.yml).
# The database may then be ahead of the running API, so this run must not resume it unless it deploys.
existing="$(az webapp config access-restriction show \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${AZURE_BACKEND_APP_NAME}" \
  --query "length(ipSecurityRestrictions[?name=='deploy-pause-ipv4' || name=='deploy-pause-ipv6'])" \
  --output tsv)"
if [ "${existing}" != "0" ]; then
  echo "::warning::The API was already paused by an earlier deployment; it stays paused unless this one deploys"
else
  echo "was-live=true" >> "$GITHUB_OUTPUT"
fi

az webapp config access-restriction set \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${AZURE_BACKEND_APP_NAME}" \
  --use-same-restrictions-for-scm-site false \
  --only-show-errors \
  --output none
for rule in "deploy-pause-ipv4 0.0.0.0/0" "deploy-pause-ipv6 ::/0"; do
  set -- ${rule}
  if [ "$(az webapp config access-restriction show \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_BACKEND_APP_NAME}" \
    --query "length(ipSecurityRestrictions[?name=='$1'])" \
    --output tsv)" = "0" ]; then
    az webapp config access-restriction add \
      --resource-group "${AZURE_RESOURCE_GROUP}" \
      --name "${AZURE_BACKEND_APP_NAME}" \
      --rule-name "$1" \
      --action Deny \
      --ip-address "$2" \
      --priority 1 \
      --only-show-errors \
      --output none
  fi
done

# Wait until the restriction is enforced.
for attempt in $(seq 1 24); do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "${AZURE_BACKEND_URL}/api/checklists" || true)"
  if [ "${status}" = "403" ]; then
    break
  fi
  if [ "${attempt}" -eq 24 ]; then
    echo "::error::API was still reachable 2 minutes after pausing it"
    exit 1
  fi
  echo "API still answering (HTTP ${status}); checking again in 5 seconds"
  sleep 5
done

# Requests the old API had already accepted can keep retrying the database for minutes (see the retry policy in
# Program.cs), so restart the app to end them. The restarted API gets no requests.
# synchronous=true makes the call wait until the restart has finished.
app_id="$(az webapp show \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${AZURE_BACKEND_APP_NAME}" \
  --query id \
  --output tsv)"
az rest \
  --method post \
  --uri "https://management.azure.com${app_id}/restart?synchronous=true&api-version=2024-11-01" \
  --only-show-errors \
  --output none
echo "API paused"

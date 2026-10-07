#!/usr/bin/env bash
# Deletes a pull request's preview environment: its web app, database and storage account (see
# infra/preview.bicep). The App Service plan and SQL server shared by every preview stay. Each resource is
# deleted only if it exists, so this is safe for a PR that never had a preview (a fork or Dependabot PR) and
# after a deletion that failed partway.
# Requires PREVIEW_RESOURCE_GROUP, PREVIEW_SQL_SERVER and PR_NUMBER.
set -euo pipefail

app="checkmate-pr-${PR_NUMBER}"
database="CheckMate-pr-${PR_NUMBER}"
storage="checkmatepr${PR_NUMBER}"
deployment="preview-pr-${PR_NUMBER}"

# Closing a PR cancels a preview deployment still running for it, but the Bicep deployment it started carries
# on in Azure, and deleting resources it's still creating fails. Wait for it to finish first.
for attempt in $(seq 1 60); do
  state="$(az deployment group show \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --name "${deployment}" \
    --query properties.provisioningState \
    --output tsv 2>/dev/null || true)"
  case "${state}" in
    Running | Accepted)
      if [ "${attempt}" -eq 60 ]; then
        echo "::error::Deployment ${deployment} was still running after 10 minutes"
        exit 1
      fi
      echo "Deployment ${deployment} is still running (${state}); checking again in 10 seconds"
      sleep 10
      ;;
    *)
      break
      ;;
  esac
done

if az webapp show --resource-group "${PREVIEW_RESOURCE_GROUP}" --name "${app}" --query id --output tsv >/dev/null 2>&1; then
  echo "Deleting web app ${app}"
  # Without --keep-empty-plan, deleting the last web app on the shared plan deletes the plan too.
  az webapp delete \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --name "${app}" \
    --keep-empty-plan \
    --only-show-errors \
    --output none
else
  echo "Web app ${app} doesn't exist"
fi

if az sql db show --resource-group "${PREVIEW_RESOURCE_GROUP}" --server "${PREVIEW_SQL_SERVER}" --name "${database}" --query id --output tsv >/dev/null 2>&1; then
  echo "Deleting database ${database}"
  az sql db delete \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --server "${PREVIEW_SQL_SERVER}" \
    --name "${database}" \
    --yes \
    --only-show-errors \
    --output none
else
  echo "Database ${database} doesn't exist"
fi

if az storage account show --resource-group "${PREVIEW_RESOURCE_GROUP}" --name "${storage}" --query id --output tsv >/dev/null 2>&1; then
  echo "Deleting storage account ${storage}"
  az storage account delete \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --name "${storage}" \
    --yes \
    --only-show-errors \
    --output none
else
  echo "Storage account ${storage} doesn't exist"
fi

# The deployment record is only history; removing it keeps the resource group's deployment list short.
az deployment group delete \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --name "${deployment}" \
  --only-show-errors \
  --output none 2>/dev/null || true
echo "Preview for PR #${PR_NUMBER} deleted"

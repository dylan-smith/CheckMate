#!/usr/bin/env bash
# Deletes a pull request's preview environment: every resource infra/preview.bicep tagged with the PR's number
# (its web app, database and storage account). The App Service plan and SQL server shared by every preview
# aren't tagged, so they stay. A PR that never had a preview has no tagged resources, so this does nothing for
# it, and it can be re-run after a deletion that failed partway.
# Requires PREVIEW_RESOURCE_GROUP and PR_NUMBER.
set -euo pipefail

deployment="preview-pr-${PR_NUMBER}"

# Closing a PR cancels a preview deployment still running for it, but the Bicep deployment it started carries
# on in Azure, and deleting resources it's still creating fails. Wait for it to finish first. Only a missing
# deployment counts as finished; any other lookup error stops the cleanup rather than racing the deployment.
for attempt in $(seq 1 60); do
  if ! state="$(az deployment group show \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --name "${deployment}" \
    --query properties.provisioningState \
    --output tsv 2>&1)"; then
    if grep -q "DeploymentNotFound" <<<"${state}"; then
      state=""
    else
      echo "::error::Couldn't check deployment ${deployment}: ${state}"
      exit 1
    fi
  fi
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

# Deleting the web app as a resource (unlike `az webapp delete`) never deletes the shared plan.
# Captured first so a failed listing stops the script (a failure inside < <(...) wouldn't).
# az won't combine --tag with --resource-group, so the tag is filtered in the query.
listing="$(az resource list \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --query "[?tags.\"pr-number\" == '${PR_NUMBER}'].id" \
  --output tsv)"
ids=()
if [ -n "${listing}" ]; then
  mapfile -t ids <<<"${listing}"
fi
if [ "${#ids[@]}" -eq 0 ]; then
  echo "PR #${PR_NUMBER} has no preview resources"
fi
for id in "${ids[@]}"; do
  echo "Deleting ${id##*/providers/}"
  az resource delete --ids "${id}" --only-show-errors --output none
done

# The deployment record is only history; removing it keeps the resource group's deployment list short.
az deployment group delete \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --name "${deployment}" \
  --only-show-errors \
  --output none 2>/dev/null || true
echo "Preview for PR #${PR_NUMBER} deleted"

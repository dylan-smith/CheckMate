#!/usr/bin/env bash
# Waits for a resource group deployment of the given name to stop running. Azure refuses a new deployment with
# that name while one is running, and deleting resources it's still creating fails, and the deployment carries
# on in Azure after the job that started it is cancelled or times out. Only a missing deployment counts as not
# running; any other lookup error fails, rather than racing a deployment that may still be running.
# Usage: wait-for-deployment.sh <resource group> <deployment name>
set -euo pipefail

resource_group="$1"
deployment="$2"

for attempt in $(seq 1 60); do
  if ! state="$(az deployment group show \
    --resource-group "${resource_group}" \
    --name "${deployment}" \
    --query properties.provisioningState \
    --output tsv 2>&1)"; then
    if grep -q "DeploymentNotFound" <<<"${state}"; then
      exit 0
    fi
    echo "::error::Couldn't check deployment ${deployment}: ${state}"
    exit 1
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
      exit 0
      ;;
  esac
done

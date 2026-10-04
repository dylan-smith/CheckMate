#!/usr/bin/env bash
# Adds a release annotation for this deployment to the Application Insights resource, so the CheckMate Health
# workbook's time charts (and the portal's Failures and Performance charts) show a marker when it happened.
# The portal only draws annotations in the "Deployment" category; azure/webapps-deploy adds its own in the "Text"
# category, which never show up.
#
# Requires AZURE_RESOURCE_GROUP and DEPLOYMENT_RESULT (success, failure or cancelled), plus the GITHUB_* variables
# Actions sets.
set -euo pipefail

APP_INSIGHTS_ID="$(az resource list \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --resource-type microsoft.insights/components \
  --query '[0].id' \
  --output tsv)"
if [ -z "${APP_INSIGHTS_ID}" ]; then
  echo "::error::No Application Insights resource in ${AZURE_RESOURCE_GROUP}."
  exit 1
fi

case "${DEPLOYMENT_RESULT}" in
  success) LABEL="Success" ;;
  cancelled) LABEL="Cancelled" ;;
  *) LABEL="Error" ;;
esac
SHORT_SHA="${GITHUB_SHA:0:7}"
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

# Properties is itself a JSON string. The portal shows these keys in the annotation's details.
PROPERTIES="$(jq -n -c \
  --arg label "${LABEL}" \
  --arg description "${LABEL}: ${SHORT_SHA} ($(git log -1 --format=%s "${GITHUB_SHA}"))" \
  --arg build "${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}" \
  --arg repo "${GITHUB_REPOSITORY}" \
  --arg branch "${GITHUB_REF}" \
  --arg actor "${GITHUB_ACTOR}" \
  --arg url "${RUN_URL}" \
  '{Label: $label, ReleaseDescription: $description, BuildNumber: $build, BuildRepositoryName: $repo,
    SourceBranch: $branch, ReleaseRequestedFor: $actor, ReleaseWebUrl: $url}')"

jq -n \
  --arg id "$(cat /proc/sys/kernel/random/uuid)" \
  --arg name "Deploy ${SHORT_SHA} (${LABEL})" \
  --arg time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg properties "${PROPERTIES}" \
  '{Id: $id, AnnotationName: $name, EventTime: $time, Category: "Deployment", Properties: $properties}' \
  > "${RUNNER_TEMP}/annotation.json"

az rest \
  --method put \
  --url "https://management.azure.com${APP_INSIGHTS_ID}/Annotations?api-version=2015-05-01" \
  --body "@${RUNNER_TEMP}/annotation.json" \
  --only-show-errors \
  --output none
echo "Added deployment annotation: Deploy ${SHORT_SHA} (${LABEL})"

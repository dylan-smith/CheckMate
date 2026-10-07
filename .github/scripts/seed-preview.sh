#!/usr/bin/env bash
# Seeds a preview environment with the sample checklists in preview-seed-data.json, through the API so the data
# goes through the same validation as real use. Runs after the smoke tests, which have already waited for the API
# to be ready.
#
# A checklist's runs are past fill-outs. Each run has a response for each step, in order, with the body the API
# takes for that step's type (null to leave it blank), and is completed if it says so. They're filled out in the
# order listed, so the last is the newest, and all of them get the time of the seed itself.
#
# The database's seeded tag records a seed that finished, so redeploying a PR keeps whatever reviewers changed
# and never duplicates the samples. A new or recreated database has no tags, so it's seeded. A seed that stopped
# partway left no tag, so the next deployment seeds again, first deleting any sample checklists it had added
# (by name), and their fill-outs with them, so none is left half seeded; other checklists are left alone.
# Requires API_URL, PREVIEW_RESOURCE_GROUP and PR_NUMBER, and runs from the repository root.
set -euo pipefail

seed_file=.github/scripts/preview-seed-data.json

database="$(az resource list \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --query "[?tags.\"pr-number\" == '${PR_NUMBER}' && type == 'Microsoft.Sql/servers/databases'] | [0].{id: id, seeded: tags.seeded}" \
  --output tsv)"
read -r database_id seeded <<<"${database}" || true
if [ -z "${database_id}" ]; then
  echo "::error::PR #${PR_NUMBER} has no preview database"
  exit 1
fi
if [ "${seeded}" = "true" ]; then
  echo "The preview has already been seeded; leaving its data as it is"
  exit 0
fi

api() {
  curl --fail-with-body --silent --show-error --max-time 60 -H 'Content-Type: application/json' "$@"
}

# Only reads are retried: a retried POST or DELETE whose first attempt did go through would fail or duplicate.
existing="$(api --retry 3 --retry-all-errors "${API_URL}/api/checklists")"
for id in $(jq -r --slurpfile seed "${seed_file}" '.[] | select(.name | IN($seed[0][].name)) | .id' <<<"${existing}"); do
  echo "Deleting sample checklist ${id}, left by a seed that didn't finish"
  api -X DELETE "${API_URL}/api/checklists/${id}" --output /dev/null
done

count="$(jq length "${seed_file}")"
for i in $(seq 0 $((count - 1))); do
  name="$(jq -r ".[${i}].name" "${seed_file}")"
  id="$(jq -c "{name: .[${i}].name}" "${seed_file}" | api -X POST --data @- "${API_URL}/api/checklists" | jq -r .id)"
  steps="$(jq ".[${i}].steps | length" "${seed_file}")"
  step_ids=()
  for j in $(seq 0 $((steps - 1))); do
    step_ids+=("$(jq -c ".[${i}].steps[${j}]" "${seed_file}" |
      api -X POST --data @- "${API_URL}/api/checklists/${id}/steps" | jq -r .id)")
  done
  runs="$(jq ".[${i}].runs // [] | length" "${seed_file}")"
  for r in $(seq 0 $((runs - 1))); do
    run_id="$(api -X POST "${API_URL}/api/checklists/${id}/runs" | jq -r .id)"
    for j in "${!step_ids[@]}"; do
      response="$(jq -c ".[${i}].runs[${r}].responses[${j}]" "${seed_file}")"
      if [ "${response}" != "null" ]; then
        api -X PUT --data "${response}" "${API_URL}/api/runs/${run_id}/steps/${step_ids[j]}" --output /dev/null
      fi
    done
    if [ "$(jq ".[${i}].runs[${r}].complete" "${seed_file}")" = "true" ]; then
      api -X POST "${API_URL}/api/runs/${run_id}/complete" --output /dev/null
    fi
  done
  echo "Added checklist ${id}, \"${name}\", with ${steps} step(s) and ${runs} fill-out(s)"
done

az tag update \
  --resource-id "${database_id}" \
  --operation Merge \
  --tags seeded=true \
  --only-show-errors \
  --output none
echo "Seeded the preview with ${count} checklists"

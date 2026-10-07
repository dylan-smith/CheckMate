#!/usr/bin/env bash
# Seeds a preview environment with the sample checklists in preview-seed-data.json, through the API so the data
# goes through the same validation as real use. Only seeds a preview with no checklists (a new or recreated
# database), so redeploying a PR keeps whatever reviewers changed and never duplicates the samples. Runs after
# the smoke tests, which leave no checklists behind and have already waited for the API to be ready.
# Requires API_URL, and runs from the repository root.
set -euo pipefail

seed_file=.github/scripts/preview-seed-data.json

api() {
  curl --fail-with-body --silent --show-error --max-time 60 -H 'Content-Type: application/json' "$@"
}

# Only the read is retried: a retried POST whose first attempt did save would add a checklist twice.
existing="$(api --retry 3 --retry-all-errors "${API_URL}/api/checklists" | jq length)"
if [ "${existing}" -gt 0 ]; then
  echo "The preview already has ${existing} checklist(s); not seeding it"
  exit 0
fi

count="$(jq length "${seed_file}")"
for i in $(seq 0 $((count - 1))); do
  name="$(jq -r ".[${i}].name" "${seed_file}")"
  id="$(jq -c "{name: .[${i}].name}" "${seed_file}" | api -X POST --data @- "${API_URL}/api/checklists" | jq -r .id)"
  steps="$(jq ".[${i}].steps | length" "${seed_file}")"
  for j in $(seq 0 $((steps - 1))); do
    jq -c ".[${i}].steps[${j}]" "${seed_file}" |
      api -X POST --data @- "${API_URL}/api/checklists/${id}/steps" --output /dev/null
  done
  echo "Added checklist ${id}, \"${name}\", with ${steps} step(s)"
done
echo "Seeded the preview with ${count} checklists"

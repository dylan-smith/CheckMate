#!/usr/bin/env bash
# Seeds a preview environment with the sample checklists in preview-seed-data.json, through the API so the data
# goes through the same validation as real use. Runs after the smoke tests, which have already waited for the API
# to be ready.
#
# A checklist's runs are past fill-outs. Each run has a response for each step, in order, with the body the API
# takes for that step's type (null to leave it blank), except that a choice step's is {"option": "<its text>"}.
# A run is completed if it says so. They're filled out in the
# order listed, so the last is the newest, and all of them get the time of the seed itself.
#
# Every deployment starts the preview over: it deletes every checklist first, and their steps and fill-outs with
# them, so whatever reviewers changed is gone and the samples are never duplicated. A seed that stops partway is
# redone in full by the next deployment.
# Requires API_URL, and runs from the repository root.
set -euo pipefail

seed_file=.github/scripts/preview-seed-data.json

api() {
  curl --fail-with-body --silent --show-error --max-time 60 -H 'Content-Type: application/json' "$@"
}

# Only reads are retried: a retried POST or DELETE whose first attempt did go through would fail or duplicate.
existing="$(api --retry 3 --retry-all-errors "${API_URL}/api/checklists")"
deleted=0
for id in $(jq -r '.[].id' <<<"${existing}"); do
  api -X DELETE "${API_URL}/api/checklists/${id}" --output /dev/null
  deleted=$((deleted + 1))
done
echo "Deleted the preview's ${deleted} checklist(s)"

count="$(jq length "${seed_file}")"
for i in $(seq 0 $((count - 1))); do
  name="$(jq -r ".[${i}].name" "${seed_file}")"
  id="$(jq -c "{name: .[${i}].name}" "${seed_file}" | api -X POST --data @- "${API_URL}/api/checklists" | jq -r .id)"
  steps="$(jq ".[${i}].steps | length" "${seed_file}")"
  step_ids=()
  step_options=()
  for j in $(seq 0 $((steps - 1))); do
    step="$(jq -c ".[${i}].steps[${j}]" "${seed_file}" |
      api -X POST --data @- "${API_URL}/api/checklists/${id}/steps")"
    step_ids+=("$(jq -r .id <<<"${step}")")
    step_options+=("$(jq -c .options <<<"${step}")")
  done
  runs="$(jq ".[${i}].runs // [] | length" "${seed_file}")"
  for r in $(seq 0 $((runs - 1))); do
    run_id="$(api -X POST "${API_URL}/api/checklists/${id}/runs" | jq -r .id)"
    for j in "${!step_ids[@]}"; do
      # A choice step's option only has an id once the step is added, so the seed names it by its text instead.
      response="$(jq -c --argjson i "${i}" --argjson r "${r}" --argjson j "${j}" \
        --argjson options "${step_options[j]}" '
        .[$i].runs[$r].responses[$j]
        | if type == "object" and has("option") then
            .option as $text
            | {optionId: (first($options[] | select(.text == $text) | .id) // error("No option \"\($text)\""))}
          else . end' "${seed_file}")"
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

echo "Seeded the preview with ${count} checklists"

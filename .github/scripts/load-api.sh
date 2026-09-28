#!/usr/bin/env bash
# Calls the API directly for LOAD_DURATION_MINUTES minutes with LOAD_WORKERS parallel workers, so the CheckMate
# Health workbook has request, dependency and failure telemetry to show. Each worker keeps running a checklist
# through its lifecycle (list, create, read, rename, delete), plus a few requests that fail on purpose (a
# duplicate name, an empty name and a missing id) so the failure charts get data too. Every checklist it creates
# is deleted again, with a final sweep for any that a failed cycle left behind.
#
# Requires AZURE_BACKEND_URL, LOAD_DURATION_MINUTES (1-300) and LOAD_WORKERS (1-20). Writes a table of
# requests by status code to GITHUB_STEP_SUMMARY when set.
set -euo pipefail

for setting in "LOAD_DURATION_MINUTES 300" "LOAD_WORKERS 20"; do
  set -- ${setting}
  if ! [[ "${!1:-}" =~ ^[0-9]+$ ]] || [ "${!1}" -lt 1 ] || [ "${!1}" -gt "$2" ]; then
    echo "::error::$1 must be a whole number from 1 to $2, got '${!1:-}'"
    exit 1
  fi
done

prefix="Load test api ${GITHUB_RUN_ID:-local}"
deadline=$((SECONDS + LOAD_DURATION_MINUTES * 60))
counts_dir="$(mktemp -d)"

# Sends one request, records its status code (000 when the request itself failed) and prints the response body.
# Usage: request METHOD PATH [curl options...], e.g. request POST /api/checklists --data '{"name":"x"}'
request() {
  local method="$1" path="$2" response
  shift 2
  response="$(curl --silent --output - --write-out '\n%{http_code}' --max-time 60 \
    --request "${method}" --header 'Content-Type: application/json' "$@" \
    "${AZURE_BACKEND_URL}${path}" || echo $'\n000')"
  echo "${response##*$'\n'}" >> "${counts_dir}/${worker_id}"
  printf '%s' "${response%$'\n'*}"
}

worker() {
  worker_id="$1"
  local cycle=0 name renamed id
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    cycle=$((cycle + 1))
    name="${prefix} w${worker_id} c${cycle}"
    renamed="${name} renamed"

    request GET /api/checklists > /dev/null
    id="$(request POST /api/checklists --data "$(jq -cn --arg name "${name}" '{name: $name}')" \
      | jq -r '.id // empty' 2> /dev/null || true)"
    if [ -n "${id}" ]; then
      request GET "/api/checklists/${id}" > /dev/null
      request PUT "/api/checklists/${id}" --data "$(jq -cn --arg name "${renamed}" '{name: $name}')" > /dev/null
      # Duplicate name: 409
      request POST /api/checklists --data "$(jq -cn --arg name "${renamed}" '{name: $name}')" > /dev/null
      request DELETE "/api/checklists/${id}" > /dev/null
      # Already deleted: 404
      request GET "/api/checklists/${id}" > /dev/null
    fi
    # Empty name: 400
    request POST /api/checklists --data '{"name":"   "}' > /dev/null

    # A little think time so the workers don't hammer the API in lockstep.
    sleep "0.$((RANDOM % 9 + 1))"
  done
  echo "Worker ${worker_id} finished after ${cycle} cycles"
}

echo "Generating API load against ${AZURE_BACKEND_URL} for ${LOAD_DURATION_MINUTES} minute(s) with ${LOAD_WORKERS} worker(s)"
for w in $(seq 1 "${LOAD_WORKERS}"); do
  worker "${w}" &
done
wait

# A cycle that failed partway through (say, while the database was resuming) can leave its checklist behind.
echo "Deleting any checklists left behind"
leftovers="$(curl --silent --max-time 60 "${AZURE_BACKEND_URL}/api/checklists" \
  | jq -r --arg prefix "${prefix}" '.[] | select(.name | startswith($prefix)) | .id' 2> /dev/null || true)"
for id in ${leftovers}; do
  echo "Deleting leftover checklist ${id}"
  curl --silent --output /dev/null --max-time 60 --request DELETE "${AZURE_BACKEND_URL}/api/checklists/${id}" || true
done

echo "Requests by status code:"
summary="$(cat "${counts_dir}"/* | sort | uniq -c | sort -k2)"
echo "${summary}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## API load"
    echo
    echo "${LOAD_WORKERS} worker(s) for ${LOAD_DURATION_MINUTES} minute(s) against ${AZURE_BACKEND_URL}"
    echo
    echo "| Status | Requests |"
    echo "| --- | ---: |"
    echo "${summary}" | awk '{ print "| " $2 " | " $1 " |" }'
  } >> "${GITHUB_STEP_SUMMARY}"
fi

# Some failures are expected (the 400s, 404s and 409s above), but nothing succeeding means the API wasn't reachable.
if ! echo "${summary}" | grep -qE ' 2[0-9]{2}$'; then
  echo "::error::No request succeeded; check that the API is up and not paused by a deployment"
  exit 1
fi

#!/usr/bin/env bash
# Calls the API directly for LOAD_DURATION_MINUTES minutes with LOAD_WORKERS parallel workers, so the CheckMate
# Health workbook has request, dependency and failure telemetry to show. Each worker keeps running a checklist
# through its lifecycle (list, create, read, rename, delete), plus a few requests that fail on purpose (a
# duplicate name, an empty name and a missing id) so the failure charts get data too. Every checklist it creates
# is deleted again: each worker remembers the id of the checklist it has in flight, and a final cleanup, verified
# and retried, deletes any still there. Only ids this run created are ever deleted. The cleanup also runs when
# the script is stopped early (an error, or the runner cancelling it).
#
# Requires AZURE_BACKEND_URL, LOAD_DURATION_MINUTES (1-240) and LOAD_WORKERS (1-20). Writes a table of
# requests by status code to GITHUB_STEP_SUMMARY when set.
set -euo pipefail

for setting in "LOAD_DURATION_MINUTES 240" "LOAD_WORKERS 20"; do
  set -- ${setting}
  if ! [[ "${!1:-}" =~ ^[0-9]+$ ]] || [ "${!1}" -lt 1 ] || [ "${!1}" -gt "$2" ]; then
    echo "::error::$1 must be a whole number from 1 to $2, got '${!1:-}'"
    exit 1
  fi
done

prefix="Load test api ${GITHUB_RUN_ID:-local}"
deadline=$((SECONDS + LOAD_DURATION_MINUTES * 60))
counts_dir="$(mktemp -d)"
# One file per worker holding the id of the checklist it has created and not yet deleted.
pending_dir="$(mktemp -d)"
# Created to ask the workers to finish their current cycle and stop.
stop_file="$(mktemp -u)"

# Kills a process and everything under it, so a worker's in-flight curl doesn't outlive the worker.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2> /dev/null); do
    kill_tree "${child}"
  done
  kill "$1" 2> /dev/null || true
}

# Deletes the checklists this run created that are still there, checking each deletion and retrying while any
# remain (the API may be paused by a deployment, or the database resuming). Also runs on exit, so a cancelled or
# failed run still cleans up as far as it can. First asks the workers to stop, giving them a few seconds to finish
# the cycle they are in (which deletes its checklist), then kills any still running so they don't create more.
# Worst case the sweep takes about LOAD_WORKERS x 30 seconds per attempt; the job timeout allows for that.
cleanup() {
  trap - EXIT TERM INT
  touch "${stop_file}"
  local grace job
  for grace in 1 2 3; do
    [ -n "$(jobs -rp)" ] || break
    sleep 1
  done
  for job in $(jobs -rp); do
    kill_tree "${job}"
  done
  wait 2> /dev/null || true

  echo "Deleting any checklists left behind"
  local attempt file id status remaining
  for attempt in 1 2 3; do
    remaining=0
    for file in "${pending_dir}"/*; do
      [ -e "${file}" ] || continue
      id="$(cat "${file}")"
      status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 30 \
        --request DELETE "${AZURE_BACKEND_URL}/api/checklists/${id}" || echo 000)"
      case "${status}" in
        204 | 404)
          echo "Deleted leftover checklist ${id}"
          rm -f "${file}"
          ;;
        *)
          echo "Could not delete leftover checklist ${id} (HTTP ${status})"
          remaining=$((remaining + 1))
          ;;
      esac
    done
    if [ "${remaining}" -eq 0 ]; then
      echo "No checklists left behind"
      return
    fi
    if [ "${attempt}" -lt 3 ]; then
      echo "Retrying the cleanup in 10 seconds"
      sleep 10
    fi
  done
  echo "::warning::Could not delete leftover checklist(s) with id $(cat "${pending_dir}"/* | tr '\n' ' ')(named '${prefix} ...'); delete them by hand once the API is reachable"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# Sends one request, records its status code (000 when the request itself failed) in the counts and in
# last_status, and prints the response body.
# Usage: request METHOD PATH [curl options...], e.g. request POST /api/checklists --data '{"name":"x"}'
request() {
  local method="$1" path="$2" response
  shift 2
  response="$(curl --silent --output - --write-out '\n%{http_code}' --max-time 60 \
    --request "${method}" --header 'Content-Type: application/json' "$@" \
    "${AZURE_BACKEND_URL}${path}" || echo $'\n000')"
  last_status="${response##*$'\n'}"
  echo "${last_status}" >> "${counts_dir}/${worker_id}"
  printf '%s' "${response%$'\n'*}"
}

worker() {
  worker_id="$1"
  local cycle=0 name renamed id pending="${pending_dir}/${worker_id}"
  while [ "${SECONDS}" -lt "${deadline}" ] && [ ! -e "${stop_file}" ]; do
    cycle=$((cycle + 1))
    name="${prefix} w${worker_id} c${cycle}"
    renamed="${name} renamed"

    request GET /api/checklists > /dev/null
    id="$(request POST /api/checklists --data "$(jq -cn --arg name "${name}" '{name: $name}')" \
      | jq -r '.id // empty' 2> /dev/null || true)"
    if [ -n "${id}" ]; then
      echo "${id}" > "${pending}"
      request GET "/api/checklists/${id}" > /dev/null
      request PUT "/api/checklists/${id}" --data "$(jq -cn --arg name "${renamed}" '{name: $name}')" > /dev/null
      # Duplicate name: 409
      request POST /api/checklists --data "$(jq -cn --arg name "${renamed}" '{name: $name}')" > /dev/null
      request DELETE "/api/checklists/${id}" > /dev/null
      if [ "${last_status}" = "204" ]; then
        rm -f "${pending}"
      fi
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
cleanup

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

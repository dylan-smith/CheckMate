#!/usr/bin/env bash
# Backs up the database by exporting it to a BACPAC file in RUNNER_TEMP, and sets BACKUP_FILE (its file
# name) for later steps.
# Retries cover the serverless database resuming from auto-pause, like DbUpRunner does.
#
# Requires CONNECTION_STRING: the same one the migrations use, so the backup is always of the database they change.
set -euo pipefail

BACKUP_FILE="CheckMate-$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_SHA::7}.bacpac"
for attempt in 1 2 3 4 5; do
  if sqlpackage /Action:Export \
    /SourceConnectionString:"${CONNECTION_STRING}" \
    /TargetFile:"${RUNNER_TEMP}/${BACKUP_FILE}"; then
    break
  fi
  if [ "${attempt}" -eq 5 ]; then
    echo "::error::Database export failed after ${attempt} attempts"
    exit 1
  fi
  echo "Export attempt ${attempt} failed; retrying in 15 seconds"
  rm -f "${RUNNER_TEMP}/${BACKUP_FILE}"
  sleep 15
done
echo "BACKUP_FILE=${BACKUP_FILE}" >> "$GITHUB_ENV"

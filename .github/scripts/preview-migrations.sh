#!/usr/bin/env bash
# Keeps a pull request's preview database in step with the PR's migration scripts. DbUp runs each script once,
# by name, so a script edited after an earlier push ran it would never run again, and a migration run that
# stopped partway leaves objects behind that make the script fail when it's retried. Neither can happen to a
# shipped script, but both can while a PR is in progress, so the preview database is recreated empty instead.
#
# The database's migrations tag records how many scripts the last successful run applied and a fingerprint of
# their names and contents:
#   check   (before the Bicep deployment) deletes the database, so the deployment recreates it empty, when the
#           tag is missing (the last run didn't finish its migrations) or the scripts it covers have changed.
#           Scripts added after them don't count, so new migrations keep the database's data.
#   clear   (before the migrations) removes the tag, so a run that stops partway is caught by the next check.
#   record  (after the migrations) sets the tag for the current scripts.
# Requires PREVIEW_RESOURCE_GROUP and PR_NUMBER, and runs from the repository root.
set -euo pipefail

scripts_dir=backend/CheckMate.Database/Scripts
# DbUp applies the scripts in name order.
mapfile -t scripts < <(find "${scripts_dir}" -maxdepth 1 -name '*.sql' -printf '%f\n' | LC_ALL=C sort)

# Fingerprint of the first $1 scripts' names and contents.
fingerprint() {
  for name in "${scripts[@]:0:$1}"; do
    printf '%s %s\n' "${name}" "$(sha256sum <"${scripts_dir}/${name}" | cut -d' ' -f1)"
  done | sha256sum | cut -c1-16
}

# az won't combine --tag with --resource-group, so the tag and type are filtered in the query.
database="$(az resource list \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --query "[?tags.\"pr-number\" == '${PR_NUMBER}' && type == 'Microsoft.Sql/servers/databases'] | [0].{id: id, migrations: tags.migrations}" \
  --output tsv)"
read -r database_id applied <<<"${database}" || true
if [ "${1:-}" != check ] && [ -z "${database_id}" ]; then
  echo "::error::PR #${PR_NUMBER} has no preview database"
  exit 1
fi

case "${1:-}" in
  check)
    if [ -z "${database_id}" ]; then
      echo "PR #${PR_NUMBER} has no preview database yet"
      exit 0
    fi
    reason=""
    if [ -z "${applied}" ] || [ "${applied}" = "None" ]; then
      reason="its last migration run didn't finish"
    else
      count="${applied%%:*}"
      if [ "${count}" -gt "${#scripts[@]}" ]; then
        reason="a migration script it ran has been removed"
      elif [ "${applied#*:}" != "$(fingerprint "${count}")" ]; then
        reason="a migration script it ran has changed"
      fi
    fi
    if [ -n "${reason}" ]; then
      echo "::notice::Recreating the preview database empty, since ${reason}"
      az resource delete --ids "${database_id}" --only-show-errors --output none
    else
      echo "The preview database is up to date with its migration scripts"
    fi
    ;;
  clear)
    az tag update \
      --resource-id "${database_id}" \
      --operation Replace \
      --tags "pr-number=${PR_NUMBER}" \
      --only-show-errors \
      --output none
    ;;
  record)
    az tag update \
      --resource-id "${database_id}" \
      --operation Merge \
      --tags "migrations=${#scripts[@]}:$(fingerprint "${#scripts[@]}")" \
      --only-show-errors \
      --output none
    ;;
  *)
    echo "Usage: $0 check|clear|record" >&2
    exit 2
    ;;
esac

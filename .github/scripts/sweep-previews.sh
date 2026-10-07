#!/usr/bin/env bash
# Deletes the preview environments of closed pull requests whose own cleanup failed. Every per-PR resource
# carries a pr-number tag (infra/preview.bicep). The PR being closed now (CURRENT_PR) is skipped: its delete job
# already ran, and its comment says whether that worked, which a retry here would leave out of date.
#
# A PR that can't be read is kept, since deleting a live preview is worse than keeping a stale one until the
# next sweep. One failed deletion doesn't stop the others; the script fails at the end if any did.
# Requires PREVIEW_RESOURCE_GROUP, CURRENT_PR, GITHUB_REPOSITORY and GH_TOKEN, and runs from the repository root.
set -euo pipefail

listing="$(az resource list \
  --resource-group "${PREVIEW_RESOURCE_GROUP}" \
  --query '[?tags."pr-number"].tags."pr-number"' \
  --output tsv)"

failed=()
for pr in $(sort -un <<<"${listing}"); do
  if [ "${pr}" = "${CURRENT_PR}" ]; then
    continue
  fi
  state="$(gh pr view "${pr}" --repo "${GITHUB_REPOSITORY}" --json state --jq .state 2>/dev/null || echo UNKNOWN)"
  case "${state}" in
    OPEN)
      echo "PR #${pr} is open; keeping its preview"
      ;;
    UNKNOWN)
      echo "::warning::Couldn't read PR #${pr}; keeping its preview"
      ;;
    *)
      echo "PR #${pr} is ${state}; deleting its preview"
      if ! PR_NUMBER="${pr}" bash .github/scripts/delete-preview.sh; then
        echo "::warning::Deleting the preview for PR #${pr} failed"
        failed+=("#${pr}")
      fi
      ;;
  esac
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::Couldn't delete the previews for PRs ${failed[*]}"
  exit 1
fi

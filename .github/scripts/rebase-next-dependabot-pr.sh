#!/usr/bin/env bash
# Asks Dependabot to rebase the oldest open Dependabot PR that has auto-merge enabled and is behind main, unless
# one is already up to date and running its checks (it's on its way in, so the next one waits for it).
# Requires GH_TOKEN (a user's token: Dependabot ignores commands from github-actions[bot]) and GH_REPO.
set -euo pipefail

prs=$(gh pr list --app dependabot --state open \
  --json number,mergeStateStatus,autoMergeRequest,createdAt,statusCheckRollup \
  --jq 'map(select(.autoMergeRequest != null)) | sort_by(.createdAt)')

# An up-to-date PR with checks still running is already on its way in; let it finish
in_flight=$(echo "$prs" | jq -r '
  map(select(.mergeStateStatus != "BEHIND"
             and any(.statusCheckRollup[]; (.status // "COMPLETED") != "COMPLETED"
                                            or .state == "PENDING")))
  | first | .number // empty')
if [ -n "$in_flight" ]; then
  echo "PR #$in_flight is already running checks"
  exit 0
fi

next=$(echo "$prs" | jq -r 'map(select(.mergeStateStatus == "BEHIND")) | first | .number // empty')
if [ -z "$next" ]; then
  echo "No Dependabot PRs are behind main"
  exit 0
fi

echo "Requesting rebase of PR #$next"
gh pr comment "$next" --body "@dependabot rebase"

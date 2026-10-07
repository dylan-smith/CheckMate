#!/usr/bin/env bash
# Checks whether this run should still deploy the pull request's preview, and writes current=true or false to
# $GITHUB_OUTPUT. The deploy lock (the preview-<N> concurrency group) is taken once a run's build jobs finish, so
# runs don't take it in commit order: an older run whose builds finish late could otherwise deploy over a newer
# commit, and a run still building when the PR closes could recreate the preview after it's been deleted. Only
# the run for the PR's current head commit, while the PR is open, deploys.
# Requires PR_NUMBER, HEAD_SHA (the commit this run is for), GITHUB_REPOSITORY and GH_TOKEN.
set -euo pipefail

pr="$(gh pr view "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --json state,headRefOid --jq '"\(.state) \(.headRefOid)"')"
read -r state head <<<"${pr}"

if [ "${state}" != "OPEN" ]; then
  echo "::notice::PR #${PR_NUMBER} is ${state}, so its preview isn't deployed"
  echo "current=false" >>"${GITHUB_OUTPUT}"
elif [ "${head}" != "${HEAD_SHA}" ]; then
  echo "::notice::PR #${PR_NUMBER} has moved on to ${head:0:7}, so this run for ${HEAD_SHA:0:7} doesn't deploy it"
  echo "current=false" >>"${GITHUB_OUTPUT}"
else
  echo "current=true" >>"${GITHUB_OUTPUT}"
fi

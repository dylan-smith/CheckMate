#!/usr/bin/env bash
# Opens the PR that removes the System.Security.Cryptography.Pkcs pin, once the Pkcs pin check workflow finds the
# backend builds cleanly without it. The PR has the project edits pkcs-pin-try.sh made, and deletes the
# workflow and its scripts (this one included), which are no longer needed. Does nothing if the PR is already
# open.
# Requires GH_TOKEN (TS_COMPAT_PR_TOKEN, which can push workflow changes), BRANCH and GITHUB_REPOSITORY, and runs
# from the repository root.
set -euo pipefail

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::The backend builds without the System.Security.Cryptography.Pkcs pin, but the TS_COMPAT_PR_TOKEN secret isn't set so the PR can't be created."
  exit 1
fi

if [ "$(gh pr list --head "$BRANCH" --state open --json number --jq length)" != "0" ]; then
  echo "PR already open, nothing to do."
  exit 0
fi

git rm -q .github/workflows/pkcs-pin-check.yml .github/scripts/pkcs-pin-*.sh

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -b "$BRANCH"
git commit -am "Remove the System.Security.Cryptography.Pkcs pin" \
  -m "SqlClient no longer brings in a vulnerable version, so the backend builds without warnings without it."
git push --force "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH"

gh pr create --base main --head "$BRANCH" \
  --title "Remove the System.Security.Cryptography.Pkcs pin" \
  --body "The nightly Pkcs pin check found that, without its direct reference to \`System.Security.Cryptography.Pkcs\`, the backend now builds without warnings and has no vulnerable packages, so the transitive version SqlClient brings in no longer has known vulnerabilities.

This PR:
- removes the \`System.Security.Cryptography.Pkcs\` package reference from the backend projects
- deletes the nightly \`pkcs-pin-check\` workflow and its scripts, which are no longer needed"

#!/usr/bin/env bash
# Opens the PR that allows Dependabot TypeScript major updates, once the TypeScript/ESLint compatibility workflow
# finds the latest TypeScript works with typescript-eslint. The PR removes the Dependabot ignore rule and deletes
# the workflow and its scripts (this one included), which are no longer needed. Does nothing if the PR is
# already open.
# Requires GH_TOKEN (TS_COMPAT_PR_TOKEN, which can push workflow changes), LATEST, BRANCH and GITHUB_REPOSITORY,
# and runs from the repository root.
set -euo pipefail

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::typescript@$LATEST works with typescript-eslint, but the TS_COMPAT_PR_TOKEN secret isn't set so the PR can't be created."
  exit 1
fi

if [ "$(gh pr list --head "$BRANCH" --state open --json number --jq length)" != "0" ]; then
  echo "PR already open, nothing to do."
  exit 0
fi

git checkout -- frontend
sed -i '/# BEGIN typescript-major-ignore/,/# END typescript-major-ignore/d' .github/dependabot.yml
git rm -q .github/workflows/typescript-eslint-compat.yml .github/scripts/typescript-compat-*.sh

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -b "$BRANCH"
git commit -am "Allow dependabot TypeScript major updates" \
  -m "typescript@$LATEST now works with the latest typescript-eslint."
git push --force "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH"

gh pr create --base main --head "$BRANCH" \
  --title "Allow dependabot TypeScript major updates" \
  --body "The nightly TypeScript/ESLint compatibility check found that \`typescript@$LATEST\` now installs and lints cleanly with the latest \`typescript-eslint\`.

This PR:
- removes the dependabot ignore rule for TypeScript major updates, so dependabot will open the upgrade PR
- deletes the nightly \`typescript-eslint-compat\` workflow and its scripts, which are no longer needed"

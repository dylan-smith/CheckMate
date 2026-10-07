#!/usr/bin/env bash
# Compares the installed TypeScript version with the latest release, for the TypeScript/ESLint compatibility
# workflow. Writes latest (the latest version) and newer-major (true when its major version is newer) to
# $GITHUB_OUTPUT. Runs from frontend/.
set -euo pipefail

latest=$(npm view typescript version)
current=$(node -p "require('./package-lock.json').packages['node_modules/typescript'].version")
echo "Current: $current, latest: $latest"
echo "latest=$latest" >>"$GITHUB_OUTPUT"
if [ "${latest%%.*}" -gt "${current%%.*}" ]; then
  echo "newer-major=true" >>"$GITHUB_OUTPUT"
else
  echo "newer-major=false" >>"$GITHUB_OUTPUT"
fi

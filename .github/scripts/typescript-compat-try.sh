#!/usr/bin/env bash
# Tries the latest TypeScript with the latest typescript-eslint, for the TypeScript/ESLint compatibility
# workflow, and writes compatible=true or false to $GITHUB_OUTPUT. npm install fails on peer dependency
# conflicts, and eslint fails if typescript-eslint can't load the compiler API, so both passing means the
# upgrade is viable. Requires LATEST (the latest TypeScript version), and runs from frontend/.
set -euo pipefail

if npm install --save-dev typescript@latest typescript-eslint@latest && npx eslint .; then
  echo "compatible=true" >>"$GITHUB_OUTPUT"
else
  echo "::notice::typescript@${LATEST} is not yet compatible with typescript-eslint"
  echo "compatible=false" >>"$GITHUB_OUTPUT"
fi

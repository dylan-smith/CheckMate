#!/usr/bin/env bash
# Removes the System.Security.Cryptography.Pkcs pin (its PackageReference and the comment above it) from every
# backend project, for the Pkcs pin check workflow, then restores and builds. Warnings are errors, so NuGet's
# vulnerability warnings (NU1902/NU1903) fail the restore while SqlClient still brings in a vulnerable version,
# and the check also lists vulnerable packages to be sure. Writes needed=true or false to $GITHUB_OUTPUT, and leaves the projects edited for pkcs-pin-open-pr.sh. Fails
# if no project has the pin, so the check doesn't report it as removable before it's there. Runs from the
# repository root.
set -euo pipefail

mapfile -t projects < <(grep -rl --include='*.csproj' 'PackageReference Include="System.Security.Cryptography.Pkcs"' backend)
if [ "${#projects[@]}" -eq 0 ]; then
  echo "::error::No backend project references System.Security.Cryptography.Pkcs directly, so there's no pin to check."
  exit 1
fi

for project in "${projects[@]}"; do
  echo "Removing the pin from $project"
  awk '
    /PackageReference Include="System.Security.Cryptography.Pkcs"/ {
      if (held && prev ~ /^[[:space:]]*<!--.*-->[[:space:]]*$/) held = 0
      next
    }
    { if (held) print prev; prev = $0; held = 1 }
    END { if (held) print prev }
  ' "$project" >"$project.tmp"
  mv "$project.tmp" "$project"
done
git diff

# The vulnerability data restore audits against can lag what nuget.org reports (one CI run's restore passed and
# another's failed minutes later), so a clean build alone isn't enough: no package can be listed as vulnerable.
vulnerable="${RUNNER_TEMP:-/tmp}/vulnerable-packages.txt"
if dotnet restore && dotnet build --no-restore &&
  dotnet package list --vulnerable --include-transitive >"$vulnerable" && cat "$vulnerable" &&
  ! grep -q 'has the following vulnerable packages' "$vulnerable"; then
  echo "needed=false" >>"$GITHUB_OUTPUT"
else
  echo "::notice::Without the System.Security.Cryptography.Pkcs pin, the backend still has a vulnerable package or doesn't build without warnings"
  echo "needed=true" >>"$GITHUB_OUTPUT"
fi

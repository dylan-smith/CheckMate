#!/usr/bin/env bash
set -euo pipefail

# Docker creates named volumes as root, so hand them to the container user.
sudo chown "$(id -u):$(id -g)" backend/*/bin backend/*/obj frontend/node_modules
sudo chown -R "$(id -u):$(id -g)" "$CLAUDE_CONFIG_DIR"

dotnet restore
(cd frontend && npm ci && npx playwright install chromium --with-deps)

# Create the database and apply the DbUp scripts. DbUpRunner retries while SQL Server starts up.
dotnet run --project backend/CheckMate.Database -- "$ConnectionStrings__CheckMate"

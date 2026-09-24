# CheckMate

[![CI](https://github.com/dylan-smith/CheckMate2/actions/workflows/ci.yml/badge.svg)](https://github.com/dylan-smith/CheckMate2/actions/workflows/ci.yml)

A checklist management app with:
- **Backend:** ASP.NET Core Web API (.NET 10) + Entity Framework Core + SQL Server
- **Frontend:** React 19 + TypeScript (Vite + Material UI)

## Features

- Create, edit, and delete checklists
- Enforces unique checklist names
- RESTful API with OpenAPI support

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) (LTS recommended)
- [npm](https://www.npmjs.com/)
- SQL Server (optional — an in-memory database is used by default in development)

## Local Development Setup

### Backend

```bash
cd backend/CheckMate.Api
dotnet run
```

The API starts at `http://localhost:5269` by default. In development mode an in-memory database is used automatically (configured in `appsettings.Development.json`).

To use SQL Server for local development instead, set `UseInMemoryDatabase` to `false` and update the connection string in `backend/CheckMate.Api/appsettings.Development.json`.

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

The frontend dev server starts at `http://localhost:5173`. Set the `VITE_API_BASE_URL` environment variable if your backend runs on a different URL.

## Common Tasks

### Running Backend Tests

```bash
cd backend/CheckMate.Api.Tests
dotnet test
```

### Linting the Frontend

```bash
cd frontend
npm run lint
```

### Building the Frontend for Production

```bash
cd frontend
npm run build
```

The output is written to `frontend/dist`.

### Previewing the Production Build

```bash
cd frontend
npm run preview
```

## Deployment

1. **Backend** — Publish the API with `dotnet publish -c Release` from `backend/CheckMate.Api`. Deploy the output to any host that supports .NET 10 (Azure App Service, Docker, etc.). Configure the `ConnectionStrings:CheckMate` setting to point to your production SQL Server instance and set `UseInMemoryDatabase` to `false`. If the frontend will be served from a different origin than the API, also configure `Cors:AllowedOrigins` to include the production frontend URL(s) so the browser can call the API.

   **Application Insights** — The API automatically sends telemetry to Azure Application Insights when a connection string is available. Set the `APPLICATIONINSIGHTS_CONNECTION_STRING` environment variable (or the `AzureMonitor:ConnectionString` app setting) to your Application Insights connection string. When using Azure App Service, you can connect Application Insights directly from the Azure Portal, which sets `APPLICATIONINSIGHTS_CONNECTION_STRING` automatically. Telemetry is silently disabled when neither value is configured (e.g. during local development).

2. **Frontend** — Run `npm run build` in `frontend` and serve the contents of `frontend/dist` with any static file host (Azure Storage Account static website, Nginx, etc.). Set `VITE_API_BASE_URL` to the production API URL before building. When using a different origin for the frontend, make sure the backend `Cors:AllowedOrigins` setting includes that frontend URL.

## Project Structure

```
CheckMate/
├── backend/
│   ├── CheckMate.Api/          # ASP.NET Core Web API
│   ├── CheckMate.Database/     # Database CLI project for migrations
│   └── CheckMate.Api.Tests/    # xUnit backend tests
├── frontend/                    # React + TypeScript (Vite)
├── infra/                       # Bicep Infrastructure as Code
│   ├── main.bicep               # Root Bicep template
│   ├── main.bicepparam          # Example parameter values
│   └── modules/                 # Reusable Bicep modules
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── README.md
```

## Run Playwright E2E tests

Playwright automatically starts the backend and frontend servers when tests run.
Before running tests for the first time, install dependencies and the test browser:

```bash
cd frontend
npm ci
npx playwright install chromium --with-deps
```

Then run the tests (this builds the frontend and launches both servers automatically):

```bash
npm run test:e2e
```

To run tests with the interactive UI:
```bash
npm run test:e2e:ui
```

## Azure Deployment

The CI workflow (`.github/workflows/ci.yml`) includes deployment jobs that run after all checks pass. Deployment only runs on pushes to `main` (not on pull requests).

### Infrastructure as Code

All Azure resources are defined using [Bicep](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview) templates located in the `infra/` directory:

```
infra/
├── main.bicep           # Root template — wires all modules together
├── main.bicepparam      # Production parameter values (resource names, regions, SKUs)
└── modules/
    ├── appservice.bicep # App Service Plan + App Service (Windows/.NET 10) and its app settings
    ├── monitoring.bicep # Log Analytics Workspace + Application Insights
    ├── sql.bicep        # Azure SQL Server (Entra-only auth) + serverless Database
    └── storage.bicep    # Storage Account for the frontend static website
```

The `deploy-infrastructure` CI job runs `infra/main.bicep` on every push to `main`, ensuring the Azure environment is always in sync with the declared configuration. All other deployment jobs depend on this job.

The template owns **all** App Service app settings (connection string, CORS origin, Application Insights), so add new settings in `infra/modules/appservice.bicep` rather than in the portal — anything set by hand is removed on the next deployment. The static website (`$web` container, `index.html` documents) is a data-plane setting that ARM can't manage, so CI enables it with `az storage blob service-properties update`.

#### Deploying Infrastructure Manually

To preview or apply infrastructure changes outside of CI, log in to Azure (`az login`, with MFA), set the runtime connection string, and run:

```bash
export AZURE_SQL_CONNECTION_STRING='<connection string>'

# Preview — should show no Create/Delete against the existing resources
az deployment group what-if \
  --resource-group Checkmate2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

# Apply
az deployment group create \
  --resource-group Checkmate2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

### Deployment Architecture

| Component | Azure Service | Endpoint |
|-----------|--------------|----------|
| Backend API | Azure App Service (Windows/.NET 10) | `https://checkmate2-hkbqbkbyhdceexc4.westus2-01.azurewebsites.net` |
| Frontend | Azure Storage Account (static website) | `https://checkmate2.z22.web.core.windows.net` |
| Database | Azure SQL serverless database (Entra-only auth) | — |
| Monitoring | Log Analytics + Application Insights (App Service HTTP/console/app/platform logs go to the `Checkmate2` workspace) | — |

### Required GitHub Variables

| Variable | Description |
|----------|-------------|
| `AZURE_CLIENT_ID` | Azure service principal client ID (for OIDC login) |
| `AZURE_TENANT_ID` | Azure Active Directory tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Azure resource group containing all resources |
| `AZURE_BACKEND_APP_NAME` | Name of the Azure App Service for the backend |
| `AZURE_BACKEND_URL` | Public URL of the backend API (e.g. `https://checkmate-api.azurewebsites.net`) |
| `AZURE_STORAGE_ACCOUNT_NAME` | Name of the Azure Storage Account used to host the frontend static website |

All other resource names, regions and SKUs live in `infra/main.bicepparam`.

The `infrastructure-what-if` PR job doesn't use the `production` environment, so it only sees **repository-level** variables. Define these at repository level (the environment can keep its own copies):

| Variable | Description |
|----------|-------------|
| `AZURE_WHATIF_CLIENT_ID` | Client ID of the read-only managed identity used for PR what-if previews |
| `AZURE_TENANT_ID` | Azure Active Directory tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Azure resource group containing all resources |

The what-if identity is a user-assigned managed identity with a federated credential for this repository's `pull_request` tokens and a custom role on the resource group limited to `*/read`, `Microsoft.Resources/deployments/validate/action`, `Microsoft.Resources/deployments/whatIf/action` and `Microsoft.Resources/deployments/write` (needed for nested module deployments; it can't write any resource).

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AZURE_SQL_CONNECTION_STRING` | SQL Server connection string used at runtime and for migrations (applied to the App Service by the Bicep deployment) |

### Environment

The workflow uses the `production` GitHub Environment for all deployments. Configure the `production` environment in your repository settings to enable approval gates and environment-specific secrets, and restrict its deployment branches to `main` so pull requests can't use its credentials or secrets.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

Use the provided templates when opening issues or pull requests:

- [Bug Report](https://github.com/dylan-smith/CheckMate2/issues/new?template=bug_report.md)
- [Feature Request](https://github.com/dylan-smith/CheckMate2/issues/new?template=feature_request.md)
- [Enhancement](https://github.com/dylan-smith/CheckMate2/issues/new?template=enhancement.md)

Pull requests should follow the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) checklist before requesting review.

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

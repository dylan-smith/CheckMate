# AGENTS.md

Instructions for AI coding agents (Claude Code, GitHub Copilot, Codex, etc.) working in this repository.
See [README.md](README.md) for full setup, deployment and Azure details.

## Project overview

CheckMate is a checklist management app.

- `backend/CheckMate.Api`: ASP.NET Core Web API (.NET 10) with EF Core, SQL Server and controllers.
  OpenAPI is served at `/openapi/v1.json` and Scalar at `/scalar` in every environment.
- `backend/CheckMate.Database`: DbUp console app that runs the SQL migrations in `Scripts/`.
- `backend/CheckMate.Api.Tests`: xUnit backend tests.
- `frontend`: React 19 + TypeScript + Material UI (Vite). Unit tests use Vitest in `src/test`,
  and Playwright E2E tests are in `e2e`.
- `infra`: Bicep templates for Azure (App Service, Azure SQL serverless, Storage static website,
  monitoring).
- `.github/workflows/ci.yml`: build, test, CodeQL, E2E, PR what-if preview, and deploy to
  production on `main`.

## Validation commands

Run the checks for every area you change. These match CI.

Backend (from repo root):

```bash
dotnet restore
dotnet build --no-restore
dotnet format CheckMate.slnx --verify-no-changes --no-restore
dotnet test --no-build
```

Frontend (from `frontend/`):

```bash
npm ci
npx tsc -b
npx vite build
npx eslint .
npx prettier --check .
npm test
```

E2E (from `frontend/`; Playwright starts the backend and frontend itself):

```bash
npx playwright install chromium --with-deps   # first time only
npm run test:e2e
```

## Running locally

- Backend: `cd backend/CheckMate.Api && dotnet run` runs at `http://localhost:5269`. Development
  uses an in-memory database by default (`UseInMemoryDatabase` in `appsettings.Development.json`).
- Frontend: `cd frontend && npm run dev` runs at `http://localhost:5173`. Set `VITE_API_BASE_URL`
  if the API is elsewhere.

## Conventions

- Keep changes minimal and scoped to the requested task. Don't edit unrelated files for style.
- Reuse existing patterns and naming in nearby files, and match the surrounding comment density.
- Avoid new dependencies unless they're needed.
- Formatting is enforced: `.editorconfig` + `dotnet format` for C#, Prettier + ESLint for the
  frontend. Line endings are LF.
- Add or update tests for new or changed behavior.

### Database

- The schema is owned by DbUp scripts in `backend/CheckMate.Database/Scripts/`, not EF Core
  migrations. For a schema change, add a new numbered script (e.g. `0002-Description.sql`) and
  never edit one that has already shipped. Keep the EF model in `CheckMate.Api` in sync with it.
- Production is Azure SQL serverless, which auto-pauses. Keep the transient-error retry handling
  in `Program.cs` and `DbUpRunner.cs` intact.

### Infrastructure

- Bicep in `infra/` owns **all** App Service app settings. Add new settings in
  `infra/modules/appservice.bicep`, never by hand in the portal.
- The template doesn't manage identities, role assignments or database users. Those are set up
  manually (see README).
- Pushes to `main` deploy to production, so treat changes to `ci.yml` and `infra/` with care.

## Pull requests

- Keep PRs small and focused, and follow `.github/PULL_REQUEST_TEMPLATE.md`.
- Make sure the backend and frontend checks pass for the areas you touched.
- When a change affects the UI, take screenshots and attach them to the PR description.

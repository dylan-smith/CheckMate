# Contributing to CheckMate

Thank you for your interest in contributing to CheckMate! This document provides guidelines and instructions for contributing.

## Branch Protection

The `main` branch should be protected with the following rules:

> These rules must be configured in GitHub branch protection settings for the repository and may not be present in forks by default.

- **Pull request reviews required** — At least one approving review is required before merging.
- **No direct pushes** — All changes must go through a pull request.
- **Status checks must pass** — The following CI checks should be required before merging:
  - **Backend Build & Test** — Backend build and test validation
  - **Frontend Build & Lint** — Frontend build and lint validation

## Getting Started

1. Fork the repository and clone your fork locally.
2. Follow the setup instructions in [README.md](README.md) to get the app running.
3. Create a new branch for your changes (`git checkout -b my-feature`).

## Development Environment

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) (LTS recommended)
- [npm](https://www.npmjs.com/)
- SQL Server (optional — the app uses an in-memory database in development)

### Running Locally

**Backend:**

```bash
cd backend/CheckMate.Api
dotnet run
```

**Frontend:**

```bash
cd frontend
npm ci
npm run dev
```

See the [README](README.md) for more details.

## Making Changes

- Keep changes focused — one feature or fix per pull request.
- Follow existing code style and conventions.
- Write or update tests for any new or changed functionality.

### Backend

- Code lives in `backend/CheckMate.Api`.
- Tests are in `backend/CheckMate.Api.Tests` and use xUnit.
- Run tests with:

```bash
cd backend/CheckMate.Api.Tests
dotnet test
```

### Frontend

- Code lives in `frontend/src`.
- Lint with:

```bash
cd frontend
npm run lint
```

- Build with:

```bash
cd frontend
npm run build
```

## Submitting a Pull Request

1. Ensure all tests pass and there are no lint errors.
2. Push your branch to your fork.
3. Open a pull request against the `main` branch of this repository.
4. Provide a clear description of your changes in the pull request.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/dylan-smith/CheckMate/issues) with:

- A clear description of the problem.
- Steps to reproduce.
- Expected vs. actual behavior.

## Security

If you discover a security vulnerability, please follow the process described in [SECURITY.md](SECURITY.md). **Do not** open a public issue for security vulnerabilities.

## Code of Conduct

Be respectful and constructive. We expect all contributors to act professionally and to make this a welcoming community for everyone.

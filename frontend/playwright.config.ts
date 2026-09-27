import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html'],
        ['junit', { outputFile: 'playwright-report/results.xml' }],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'dotnet run --project ../backend/CheckMate.Api',
      url: 'http://localhost:5269/api/checklists',
      // Never reuse an API that is already running: it may use a real database, and the tests delete
      // every checklist. If port 5269 is taken, Playwright fails instead.
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ASPNETCORE_URLS: 'http://localhost:5269',
        ASPNETCORE_ENVIRONMENT: 'Development',
        // Always in-memory: the tests delete existing checklists, so keep them away from a real database.
        UseInMemoryDatabase: 'true',
      },
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
})

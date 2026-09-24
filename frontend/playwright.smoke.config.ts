import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/smoke.spec.ts',
  globalSetup: './e2e/smoke.global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { outputFolder: 'playwright-report/smoke' }],
        ['junit', { outputFile: 'playwright-report/smoke-results.xml' }],
      ]
    : 'list',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})

import { defineConfig } from '@playwright/test'

// Load generation against the deployed site (see e2e/load.spec.ts and the Generate Load workflow). Each
// virtual user is a test that runs for the whole duration, so they all need their own worker and no timeout.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/load.spec.ts',
  globalTeardown: './e2e/load.global-teardown.ts',
  fullyParallel: true,
  workers: Number(process.env.LOAD_USERS ?? 1),
  timeout: 0,
  retries: 0,
  reporter: 'list',
  expect: {
    // Production answers slower than a local run, so give each step a generous timeout.
    timeout: 60_000,
  },
  use: {
    baseURL: process.env.LOAD_BASE_URL ?? 'http://localhost:4173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})

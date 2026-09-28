import { defineConfig } from '@playwright/test'

// Load generation against the deployed site (see e2e/load.spec.ts and the Generate Load workflow). Each
// virtual user is a test that runs for the whole duration, so they all need their own worker.
const durationMinutes = Number(process.env.LOAD_DURATION_MINUTES ?? 1)
// A virtual user stops starting visits at the deadline, so its test only runs over by the last visit. The margin
// covers that visit even when the database is resuming, and fails a user that hangs instead of letting it run
// until the job times out.
const LAST_VISIT_MARGIN_MS = 10 * 60_000

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/load.spec.ts',
  globalTeardown: './e2e/load.global-teardown.ts',
  fullyParallel: true,
  workers: Number(process.env.LOAD_USERS ?? 1),
  timeout: durationMinutes * 60_000 + LAST_VISIT_MARGIN_MS,
  retries: 0,
  reporter: 'list',
  expect: {
    // Production answers slower than a local run, so give each step a generous timeout.
    timeout: 60_000,
  },
  use: {
    baseURL: process.env.LOAD_BASE_URL ?? 'http://localhost:4173',
    trace: 'off',
    // Without these, an action or wait has no limit of its own. A request the browser blocks (say, while a
    // deployment has the API paused) then never answers, and the visit waits forever instead of failing.
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})

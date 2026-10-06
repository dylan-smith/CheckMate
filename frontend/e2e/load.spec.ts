import {
  test,
  expect,
  type Browser,
  type Page,
  type Response,
} from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pendingDir } from './load.global-teardown'

// Uses the deployed frontend the way a few people would at once, for LOAD_DURATION_MINUTES minutes, so the
// CheckMate Health workbook has page views, browser timings, checklist events and the API calls behind them to
// show. Each visit gets a fresh browser context, so Application Insights counts it as a new user and session.
// Not part of the E2E or smoke runs: see playwright.load.config.ts and the Generate Load workflow.

const users = readSetting('LOAD_USERS', 1, 10)
const durationMinutes = readSetting('LOAD_DURATION_MINUTES', 1, 240)
const startedAt = Date.now()
const deadline = startedAt + durationMinutes * 60_000
// How often each virtual user prints its progress, so a long run shows what it's doing.
const PROGRESS_INTERVAL_MS = 60_000
// The first visit can wait for the serverless database to resume from auto-pause.
const FIRST_LOAD_TIMEOUT_MS = 180_000
const checklistPrefix = `Load test web ${process.env.GITHUB_RUN_ID ?? 'local'}`

function readSetting(name: string, min: number, max: number) {
  const raw = process.env[name]
  if (raw === undefined) {
    return min
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `[load] ${name} must be a whole number from ${min} to ${max}, got '${raw}'.`,
    )
  }
  return value
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Clicks "Create checklist" and returns the API's response to the POST it sends.
async function clickCreate(page: Page) {
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/checklists',
  )
  await page.getByRole('button', { name: 'Create checklist' }).click()
  return created
}

// Records a created checklist's id in a file of its own under pendingDir, so load.global-teardown.ts can delete
// the checklist if the visit fails before doing so. Returns the file's path.
async function recordCreated(response: Response) {
  const { id } = (await response.json()) as { id: number }
  const pendingFile = path.join(pendingDir, String(id))
  writeFileSync(pendingFile, String(id))
  return pendingFile
}

// One person's visit: open the app, create a checklist, open and rename it, go back and try a duplicate name
// (the API answers 409, which shows up as a failed request), then open it again and delete it. The created
// checklist's id is kept in a file of its own under pendingDir until it's deleted, so load.global-teardown.ts can
// delete it if the visit fails partway.
async function visit(browser: Browser, name: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
    await expect(page.getByLabel('Loading')).toBeHidden({
      timeout: FIRST_LOAD_TIMEOUT_MS,
    })

    await page.getByLabel('Checklist name').fill(name)
    const pendingFile = await recordCreated(await clickCreate(page))
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

    const renamed = `${name} renamed`
    await page.getByLabel('Checklist name').fill(renamed)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(
      page.getByRole('heading', { name: renamed, exact: true }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'Back to checklists' }).click()
    const renamedLink = page.getByRole('link', { name: renamed, exact: true })
    await expect(renamedLink).toBeVisible()
    await page.getByLabel('Checklist name').fill(renamed)
    const duplicate = await clickCreate(page)
    if (duplicate.status() === 201) {
      // The API accepted the duplicate after all; record its id so the teardown deletes it. The assertion below
      // then fails the visit, which leaves both checklists for the teardown.
      await recordCreated(duplicate)
    }
    await expect(page.getByText('already exists')).toBeVisible()

    await renamedLink.click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(
      page.getByRole('heading', { name: 'Create checklist' }),
    ).toBeVisible()
    rmSync(pendingFile, { force: true })
    // Deleting goes back to the list, which loads again, so wait for that load too. Leaving while it's in flight
    // aborts it, and the app reports the aborted fetch as a "Failed to fetch" exception.
    await expect(page.getByLabel('Loading')).toBeHidden()
    await expect(renamedLink).toBeHidden()

    // Leaving the page makes the Application Insights SDK flush what it has buffered; give the beacon a moment.
    await page.goto('about:blank')
    await sleep(1_000)
  } finally {
    await context.close()
  }
}

for (let user = 1; user <= users; user++) {
  test(`virtual user ${user}`, async ({ browser, baseURL }) => {
    mkdirSync(pendingDir, { recursive: true })
    let succeeded = 0
    let failed = 0
    let nextProgressAt = startedAt + PROGRESS_INTERVAL_MS
    console.log(
      `[load] user ${user}: visiting ${baseURL} for ${durationMinutes} minute(s)`,
    )
    while (Date.now() < deadline) {
      const name = `${checklistPrefix} u${user} v${succeeded + failed + 1}`
      try {
        await visit(browser, name)
        succeeded++
      } catch (error) {
        // A failed visit (say, a timeout while the database resumes) is itself useful telemetry; keep going.
        failed++
        console.log(
          `[load] user ${user}: visit failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (Date.now() >= nextProgressAt) {
        const elapsedMinutes = Math.floor((Date.now() - startedAt) / 60_000)
        console.log(
          `[load] user ${user}: ${elapsedMinutes} of ${durationMinutes} minute(s), ${succeeded} visit(s) succeeded, ${failed} failed so far`,
        )
        nextProgressAt = Date.now() + PROGRESS_INTERVAL_MS
      }
      // Think time between visits, 2-6 seconds.
      await sleep(2_000 + Math.random() * 4_000)
    }
    console.log(
      `[load] user ${user}: ${succeeded} visit(s) succeeded, ${failed} failed`,
    )
    expect(succeeded, 'at least one visit should succeed').toBeGreaterThan(0)
  })
}

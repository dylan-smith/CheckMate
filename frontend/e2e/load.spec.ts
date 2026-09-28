import { test, expect, type Browser } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pendingDir } from './load.global-teardown'

// Uses the deployed frontend the way a few people would at once, for LOAD_DURATION_MINUTES minutes, so the
// CheckMate Health workbook has page views, browser timings, checklist events and the API calls behind them to
// show. Each visit gets a fresh browser context, so Application Insights counts it as a new user and session.
// Not part of the E2E or smoke runs: see playwright.load.config.ts and the Generate Load workflow.

const users = readSetting('LOAD_USERS', 1, 10)
const durationMinutes = readSetting('LOAD_DURATION_MINUTES', 1, 240)
const deadline = Date.now() + durationMinutes * 60_000
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

// One person's visit: open the app, create a checklist, rename it, try a duplicate name (the API answers
// 409, which shows up as a failed request), then delete it. The created checklist's id is kept in pendingFile
// until it's deleted, so load.global-teardown.ts can delete it if the visit fails partway through.
async function visit(browser: Browser, name: string, pendingFile: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
    await expect(page.getByLabel('Loading')).toBeHidden({
      timeout: FIRST_LOAD_TIMEOUT_MS,
    })

    await page.getByLabel('Checklist name').fill(name)
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/checklists',
    )
    await page.getByRole('button', { name: 'Create checklist' }).click()
    const { id } = (await (await created).json()) as { id: number }
    writeFileSync(pendingFile, String(id))
    const item = page
      .getByRole('listitem')
      .filter({ has: page.getByText(name, { exact: true }) })
    await expect(item).toBeVisible()

    await item.getByRole('button', { name: 'Edit' }).click()
    await expect(
      page.getByRole('heading', { name: 'Edit checklist' }),
    ).toBeVisible()
    const renamed = `${name} renamed`
    await page.getByLabel('Checklist name').fill(renamed)
    await page.getByRole('button', { name: 'Save changes' }).click()
    const renamedItem = page
      .getByRole('listitem')
      .filter({ has: page.getByText(renamed, { exact: true }) })
    await expect(renamedItem).toBeVisible()

    await page.getByLabel('Checklist name').fill(renamed)
    await page.getByRole('button', { name: 'Create checklist' }).click()
    await expect(page.getByText('already exists')).toBeVisible()

    await renamedItem.getByRole('button', { name: 'Delete' }).click()
    await expect(renamedItem).toBeHidden()
    rmSync(pendingFile, { force: true })

    // Leaving the page makes the Application Insights SDK flush what it has buffered; give the beacon a moment.
    await page.goto('about:blank')
    await sleep(1_000)
  } finally {
    await context.close()
  }
}

for (let user = 1; user <= users; user++) {
  test(`virtual user ${user}`, async ({ browser }) => {
    mkdirSync(pendingDir, { recursive: true })
    const pendingFile = path.join(pendingDir, `user-${user}`)
    let succeeded = 0
    let failed = 0
    while (Date.now() < deadline) {
      const name = `${checklistPrefix} u${user} v${succeeded + failed + 1}`
      try {
        await visit(browser, name, pendingFile)
        succeeded++
      } catch (error) {
        // A failed visit (say, a timeout while the database resumes) is itself useful telemetry; keep going.
        failed++
        console.log(
          `[load] user ${user}: visit failed: ${error instanceof Error ? error.message : String(error)}`,
        )
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

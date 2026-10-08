import type { APIRequestContext } from '@playwright/test'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const checklistsApiUrl = 'http://localhost:5269/api/checklists'

type RunSummary = { id: number; clientKey: string; completedAt: string | null }

type Run = {
  startedAt: string
  completedAt: string | null
  steps: {
    text: string
    isDone: boolean
    completedAt: string | null
    responseText: string | null
    responseNumber: number | null
  }[]
}

async function createChecklist(request: APIRequestContext, name: string) {
  const response = await request.post(checklistsApiUrl, { data: { name } })
  expect(response.ok()).toBe(true)
  const { id } = (await response.json()) as { id: number }
  for (const step of [
    { text: 'Open cylinder valves' },
    { text: 'Oxygen cell readings', type: 'Text' },
    { text: 'Loop volume (litres)', type: 'Number' },
  ]) {
    const stepResponse = await request.post(`${checklistsApiUrl}/${id}/steps`, {
      data: step,
    })
    expect(stepResponse.ok()).toBe(true)
  }
  return id
}

test.describe('Filling out offline', () => {
  test.beforeEach(async ({ request }) => {
    const response = await request.get(checklistsApiUrl)
    for (const { id } of (await response.json()) as { id: number }[]) {
      await request.delete(`${checklistsApiUrl}/${id}`)
    }
  })

  test('fills out a checklist seen earlier with no network, and syncs it once back online', async ({
    page,
    context,
    request,
  }) => {
    const id = await createChecklist(request, 'Pre-dive')

    // Seen while online, so the device keeps a copy. The service worker that opens the app itself offline is
    // separate, so this stays on the same page rather than reloading it.
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Pre-dive' })).toBeVisible()
    await page.getByRole('link', { name: 'Pre-dive' }).click()
    await expect(page.getByRole('heading', { name: 'Pre-dive' })).toBeVisible()
    await expect(page.getByText('No fill-outs yet.')).toBeVisible()

    await context.setOffline(true)
    await expect(page.getByText('Offline', { exact: true })).toBeVisible()
    await expect(page.getByText(/^You're offline\./)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add step' })).toBeDisabled()

    const before = new Date()
    await page.getByRole('button', { name: 'Fill out' }).click()
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)
    await page.getByRole('checkbox', { name: 'Open cylinder valves' }).check()
    const readings = page.getByRole('textbox', { name: 'Oxygen cell readings' })
    await readings.fill('1.21 / 1.20 / 1.22')
    await readings.press('Enter')
    await expect(page.getByText('2 of 3 done')).toBeVisible()
    const volume = page.getByRole('textbox', { name: 'Loop volume (litres)' })
    await volume.fill('3.5')
    await volume.press('Enter')
    await expect(page.getByText('3 of 3 done')).toBeVisible()
    await expect(page.getByText('Offline, 1 to sync')).toBeVisible()

    await page.getByRole('button', { name: 'Complete' }).click()
    await expect(page).toHaveURL(/\/$/)
    // The offline notice is an alert too.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Completed' }),
    ).toHaveText(
      `Completed "Pre-dive". It's saved on this device and will sync when you're online.`,
    )
    const after = new Date()

    await context.setOffline(false)
    await expect(page.getByText('Synced 1 fill-out.')).toBeVisible()
    await expect(page.getByText(/to sync/)).toBeHidden()

    // The API has the fill-out as the device had it, with the times the steps were done offline.
    const runs = (await (
      await request.get(`${checklistsApiUrl}/${id}/runs`)
    ).json()) as RunSummary[]
    expect(runs).toHaveLength(1)
    expect(runs[0]?.completedAt).not.toBeNull()
    const run = (await (
      await request.get(`http://localhost:5269/api/runs/${runs[0]?.id}`)
    ).json()) as Run
    expect(run.steps.map((step) => step.isDone)).toEqual([true, true, true])
    expect(run.steps[1]?.responseText).toBe('1.21 / 1.20 / 1.22')
    expect(run.steps[2]?.responseNumber).toBe(3.5)
    for (const time of [
      run.startedAt,
      run.completedAt,
      ...run.steps.map((step) => step.completedAt),
    ]) {
      expect(new Date(time ?? '').getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      )
      expect(new Date(time ?? '').getTime()).toBeLessThanOrEqual(
        after.getTime() + 1000,
      )
    }

    // The checklist's history shows it, synced.
    await page.goto(`/checklists/${id}`)
    const fillOuts = page.getByRole('list', { name: 'Fill-outs' })
    await expect(fillOuts.getByRole('link')).toHaveCount(1)
    await expect(fillOuts.getByRole('link')).toContainText('Completed')
    await expect(fillOuts.getByText('Not synced')).toBeHidden()
  })

  test('keeps a fill-out in progress on the device while offline and syncs each change once online', async ({
    page,
    context,
    request,
  }) => {
    const id = await createChecklist(request, 'Post-dive')
    // Seen while online, so the device keeps the list and the checklist.
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Post-dive' })).toBeVisible()
    await page.goto(`/checklists/${id}`)
    await expect(page.getByText('No fill-outs yet.')).toBeVisible()

    await context.setOffline(true)
    await page.getByRole('button', { name: 'Fill out' }).click()
    await page.getByRole('checkbox', { name: 'Open cylinder valves' }).check()
    await expect(page.getByText('1 of 3 done')).toBeVisible()
    await page.getByRole('link', { name: 'Back to checklists' }).click()
    await page.getByRole('link', { name: 'Post-dive' }).click()

    // Still there, marked as not synced, and it can be picked up again.
    const fillOuts = page.getByRole('list', { name: 'Fill-outs' })
    await expect(fillOuts.getByRole('link')).toContainText('In progress')
    await expect(fillOuts.getByText('Not synced')).toBeVisible()
    await fillOuts.getByRole('link').click()
    await expect(
      page.getByRole('checkbox', { name: 'Open cylinder valves' }),
    ).toBeChecked()

    await context.setOffline(false)
    await expect(page.getByText('Synced 1 fill-out.')).toBeVisible()
    const runs = (await (
      await request.get(`${checklistsApiUrl}/${id}/runs`)
    ).json()) as RunSummary[]
    expect(runs).toHaveLength(1)
    expect(runs[0]?.completedAt).toBeNull()
  })
})

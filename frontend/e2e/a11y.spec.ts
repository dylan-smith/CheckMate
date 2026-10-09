import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const checklistsApiUrl = 'http://localhost:5269/api/checklists'

test.describe('Accessibility', () => {
  test('main page has no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Create checklist' }),
    ).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations).toEqual([])
  })

  test('checklist page has no detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const response = await request.post(checklistsApiUrl, {
      data: { name: `A11y test checklist ${Date.now()}` },
    })
    expect(response.ok()).toBe(true)
    const { id, name } = (await response.json()) as { id: number; name: string }

    try {
      // Add two steps so the steps list and its enabled and disabled move buttons get checked too.
      for (const text of ['A11y test step', 'Another a11y test step']) {
        const stepResponse = await request.post(
          `${checklistsApiUrl}/${id}/steps`,
          { data: { text } },
        )
        expect(stepResponse.ok()).toBe(true)
      }

      await page.goto(`/checklists/${id}`)
      await expect(page.getByRole('heading', { name })).toBeVisible()
      await expect(
        page.getByText('A11y test step', { exact: true }),
      ).toBeVisible()

      const results = await new AxeBuilder({ page }).analyze()

      expect(results.violations).toEqual([])
    } finally {
      await request.delete(`${checklistsApiUrl}/${id}`)
    }
  })

  test('run page has no detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const response = await request.post(checklistsApiUrl, {
      data: { name: `A11y test run ${Date.now()}` },
    })
    expect(response.ok()).toBe(true)
    const { id, name } = (await response.json()) as { id: number; name: string }

    try {
      // Tick one of two steps so both checked and unchecked boxes get checked.
      const stepIds: number[] = []
      for (const text of ['A11y run step', 'Another a11y run step']) {
        const stepResponse = await request.post(
          `${checklistsApiUrl}/${id}/steps`,
          { data: { text } },
        )
        expect(stepResponse.ok()).toBe(true)
        stepIds.push(((await stepResponse.json()) as { id: number }).id)
      }
      const runResponse = await request.post(`${checklistsApiUrl}/${id}/runs`)
      expect(runResponse.ok()).toBe(true)
      const { id: runId, clientKey } = (await runResponse.json()) as {
        id: number
        clientKey: string
      }
      const tickResponse = await request.put(
        `http://localhost:5269/api/runs/${runId}/steps/${stepIds[0]}`,
        { data: { isDone: true } },
      )
      expect(tickResponse.ok()).toBe(true)

      await page.goto(`/runs/${clientKey}`)
      await expect(page.getByRole('heading', { name })).toBeVisible()
      await expect(
        page.getByRole('checkbox', { name: 'A11y run step', exact: true }),
      ).toBeChecked()

      const results = await new AxeBuilder({ page }).analyze()

      expect(results.violations).toEqual([])
    } finally {
      await request.delete(`${checklistsApiUrl}/${id}`)
    }
  })

  test('not found page has no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/no/such/page')
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations).toEqual([])
  })
})

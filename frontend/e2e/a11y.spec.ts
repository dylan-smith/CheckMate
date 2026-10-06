import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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
      await page.goto(`/checklists/${id}`)
      await expect(page.getByRole('heading', { name })).toBeVisible()

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

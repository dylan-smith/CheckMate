import { test, expect } from '@playwright/test'

test('smoke: app loads and displays the main heading', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
})

test('smoke: can create, open, and delete a checklist', async ({ page }) => {
  const checklistName = `Smoke Test ${Date.now()}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()

  // Create a checklist
  await page.getByLabel('Checklist name').fill(checklistName)
  await page.getByRole('button', { name: 'Create checklist' }).click()

  const checklistLink = page.getByRole('link', {
    name: checklistName,
    exact: true,
  })
  const deleteButton = page.getByRole('button', { name: 'Delete' })

  try {
    // Verify it appears in the list, then open it. Reloading checks the host serves the deep link.
    await checklistLink.click()
    await expect(
      page.getByRole('heading', { name: checklistName, exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('heading', { name: checklistName, exact: true }),
    ).toBeVisible()
  } finally {
    // Best-effort cleanup so we don't leave data behind if the test fails mid-run
    await deleteButton.click().catch(() => {})
  }

  await expect(
    page.getByRole('heading', { name: 'Create checklist' }),
  ).toBeVisible()
  await expect(checklistLink).not.toBeVisible()
})

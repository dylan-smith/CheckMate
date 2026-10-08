import { test, expect, type Page } from '@playwright/test'

// The token the signed-in smoke test uses: the service token in production, and a test sign-in elsewhere, where
// test sign-in is turned on.
const authToken = process.env.SMOKE_AUTH_TOKEN ?? 'test:Smoke User'

// Saves a session the way the frontend does after signing in (see src/auth/session.ts), before the page loads.
async function signIn(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem(
      'checkmate.session',
      JSON.stringify({ token, name: 'Smoke Test', provider: 'service' }),
    )
  }, authToken)
}

test('smoke: app loads and asks the user to sign in', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
})

test('smoke: can create, open, and delete a checklist', async ({ page }) => {
  const checklistName = `Smoke Test ${Date.now()}`
  await signIn(page)

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
  await expect(checklistLink).toBeHidden()
})

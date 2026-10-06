import { test, expect, type Page } from '@playwright/test'

// The backend started by playwright.config.ts.
const checklistsApiUrl = 'http://localhost:5269/api/checklists'

// Creates a checklist from the list page and waits for it to appear.
async function createChecklist(page: Page, name: string) {
  await page.getByLabel('Checklist name').fill(name)
  await page.getByRole('button', { name: 'Create checklist' }).click()
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
}

// Opens a checklist from the list page and waits for its detail page to load.
async function openChecklist(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page).toHaveURL(/\/checklists\/\d+$/)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

test.describe('Checklist management', () => {
  test.beforeEach(async ({ page, request }) => {
    // Delete leftover checklists (including ones other spec files created) through the API, since
    // deleting them in the UI races the page's initial load.
    const response = await request.get(checklistsApiUrl)
    expect(response.ok()).toBe(true)
    for (const { id } of (await response.json()) as { id: number }[]) {
      expect((await request.delete(`${checklistsApiUrl}/${id}`)).ok()).toBe(
        true,
      )
    }

    // Wait for the initial load to finish, so its response can't overwrite a list the test changes.
    await page.goto('/')
    await expect(page.getByText('No checklists yet.')).toBeVisible()
  })

  test.describe('Create checklist', () => {
    test('creates a new checklist', async ({ page }) => {
      await createChecklist(page, 'Daily chores')
    })

    test('trims whitespace from checklist name', async ({ page }) => {
      await page.getByLabel('Checklist name').fill('  Trimmed name  ')
      await page.getByRole('button', { name: 'Create checklist' }).click()

      await expect(
        page.getByRole('link', { name: 'Trimmed name', exact: true }),
      ).toBeVisible()
    })

    test('clears the input after creating a checklist', async ({ page }) => {
      await createChecklist(page, 'My list')
      await expect(page.getByLabel('Checklist name')).toHaveValue('')
    })

    test('displays checklists in alphabetical order', async ({ page }) => {
      await createChecklist(page, 'Zulu')
      await createChecklist(page, 'Alpha')

      const items = page.getByRole('listitem')
      await expect(items).toHaveCount(2)
      await expect(items.nth(0)).toContainText('Alpha')
      await expect(items.nth(1)).toContainText('Zulu')
    })
  })

  test.describe('Navigation', () => {
    test('opens a checklist and goes back to the list', async ({ page }) => {
      await createChecklist(page, 'Groceries')
      await openChecklist(page, 'Groceries')

      await page.getByRole('link', { name: 'Back to checklists' }).click()

      await expect(page).toHaveURL(/\/$/)
      await expect(
        page.getByRole('link', { name: 'Groceries', exact: true }),
      ).toBeVisible()
    })

    test('supports browser back and forward', async ({ page }) => {
      await createChecklist(page, 'Groceries')
      await openChecklist(page, 'Groceries')

      await page.goBack()
      await expect(
        page.getByRole('heading', { name: 'Create checklist' }),
      ).toBeVisible()

      await page.goForward()
      await expect(
        page.getByRole('heading', { name: 'Groceries', exact: true }),
      ).toBeVisible()
    })

    test('loads a checklist from a deep link', async ({ page }) => {
      await createChecklist(page, 'Deep link')
      await openChecklist(page, 'Deep link')

      await page.reload()

      await expect(
        page.getByRole('heading', { name: 'Deep link', exact: true }),
      ).toBeVisible()
      await expect(page.getByLabel('Checklist name')).toHaveValue('Deep link')
    })

    test('shows not found for a checklist that does not exist', async ({
      page,
    }) => {
      await page.goto('/checklists/999999')

      await expect(
        page.getByRole('heading', { name: 'Page not found' }),
      ).toBeVisible()
      await page.getByRole('link', { name: 'Go to checklists' }).click()
      await expect(page.getByText('No checklists yet.')).toBeVisible()
    })

    test('shows not found for an unknown route', async ({ page }) => {
      await page.goto('/no/such/page')

      await expect(
        page.getByRole('heading', { name: 'Page not found' }),
      ).toBeVisible()
    })
  })

  test.describe('Rename checklist', () => {
    test('renames a checklist from its page', async ({ page }) => {
      await createChecklist(page, 'Original')
      await openChecklist(page, 'Original')

      await page.getByLabel('Checklist name').fill('Updated')
      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect(
        page.getByRole('heading', { name: 'Updated', exact: true }),
      ).toBeVisible()

      await page.getByRole('link', { name: 'Back to checklists' }).click()
      await expect(
        page.getByRole('link', { name: 'Updated', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Original', exact: true }),
      ).toBeHidden()
    })
  })

  test.describe('Delete checklist', () => {
    test('deletes a checklist and goes back to the list', async ({ page }) => {
      await createChecklist(page, 'To delete')
      await openChecklist(page, 'To delete')

      await page.getByRole('button', { name: 'Delete' }).click()

      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByText('No checklists yet.')).toBeVisible()
    })
  })

  test.describe('Error handling', () => {
    test('shows error when creating a checklist with a duplicate name', async ({
      page,
    }) => {
      await createChecklist(page, 'Unique name')

      await page.getByLabel('Checklist name').fill('Unique name')
      await page.getByRole('button', { name: 'Create checklist' }).click()

      await expect(
        page.getByText('A checklist with this name already exists.'),
      ).toBeVisible()
    })

    test('shows error when renaming a checklist to a duplicate name', async ({
      page,
    }) => {
      await createChecklist(page, 'First')
      await createChecklist(page, 'Second')
      await openChecklist(page, 'Second')

      await page.getByLabel('Checklist name').fill('First')
      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect(
        page.getByText('A checklist with this name already exists.'),
      ).toBeVisible()
      await expect(
        page.getByRole('heading', { name: 'Second', exact: true }),
      ).toBeVisible()
    })
  })
})

import { test, expect } from '@playwright/test'

// The backend started by playwright.config.ts.
const checklistsApiUrl = 'http://localhost:5269/api/checklists'

test.describe('Checklist management', () => {
  test.beforeEach(async ({ page, request }) => {
    // Delete leftover checklists (including ones other spec files created) through the API, since
    // clicking Delete in the UI races the page's initial load.
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
      await page.getByLabel('Checklist name').fill('Daily chores')
      await page.getByRole('button', { name: 'Create checklist' }).click()

      await expect(page.getByText('Daily chores')).toBeVisible()
    })

    test('trims whitespace from checklist name', async ({ page }) => {
      await page.getByLabel('Checklist name').fill('  Trimmed name  ')
      await page.getByRole('button', { name: 'Create checklist' }).click()

      await expect(page.getByRole('listitem')).toContainText('Trimmed name')
    })

    test('clears the input after creating a checklist', async ({ page }) => {
      await page.getByLabel('Checklist name').fill('My list')
      await page.getByRole('button', { name: 'Create checklist' }).click()

      await expect(page.getByText('My list')).toBeVisible()
      await expect(page.getByLabel('Checklist name')).toHaveValue('')
    })

    test('displays checklists in alphabetical order', async ({ page }) => {
      await page.getByLabel('Checklist name').fill('Zulu')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Zulu')).toBeVisible()

      await page.getByLabel('Checklist name').fill('Alpha')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Alpha')).toBeVisible()

      const items = page.getByRole('listitem')
      await expect(items).toHaveCount(2)
      await expect(items.nth(0)).toContainText('Alpha')
      await expect(items.nth(1)).toContainText('Zulu')
    })
  })

  test.describe('Edit checklist', () => {
    test('edits an existing checklist', async ({ page }) => {
      // Create a checklist first
      await page.getByLabel('Checklist name').fill('Original')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Original')).toBeVisible()

      // Click edit
      await page.getByRole('button', { name: 'Edit' }).click()

      // Form should switch to edit mode
      await expect(
        page.getByRole('heading', { name: 'Edit checklist' }),
      ).toBeVisible()
      await expect(page.getByLabel('Checklist name')).toHaveValue('Original')

      // Update the name
      await page.getByLabel('Checklist name').clear()
      await page.getByLabel('Checklist name').fill('Updated')
      await page.getByRole('button', { name: 'Save changes' }).click()

      // Verify the update
      await expect(page.getByRole('listitem')).toContainText('Updated')
      await expect(page.getByText('Original')).not.toBeVisible()
    })

    test('cancels editing and restores create mode', async ({ page }) => {
      // Create a checklist
      await page.getByLabel('Checklist name').fill('Test item')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Test item')).toBeVisible()

      // Start editing
      await page.getByRole('button', { name: 'Edit' }).click()
      await expect(
        page.getByRole('heading', { name: 'Edit checklist' }),
      ).toBeVisible()

      // Cancel
      await page.getByRole('button', { name: 'Cancel' }).click()

      // Should restore create mode
      await expect(
        page.getByRole('heading', { name: 'Create checklist' }),
      ).toBeVisible()
      await expect(page.getByLabel('Checklist name')).toHaveValue('')
    })
  })

  test.describe('Delete checklist', () => {
    test('deletes a checklist', async ({ page }) => {
      // Create a checklist
      await page.getByLabel('Checklist name').fill('To delete')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('To delete')).toBeVisible()

      // Delete it
      await page.getByRole('button', { name: 'Delete' }).click()

      // Should show empty state
      await expect(page.getByText('No checklists yet.')).toBeVisible()
    })

    test('cancels edit mode when the edited checklist is deleted', async ({
      page,
    }) => {
      // Create a checklist
      await page.getByLabel('Checklist name').fill('Edit then delete')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Edit then delete')).toBeVisible()

      // Start editing
      await page.getByRole('button', { name: 'Edit' }).click()
      await expect(
        page.getByRole('heading', { name: 'Edit checklist' }),
      ).toBeVisible()

      // Delete the item being edited
      await page.getByRole('button', { name: 'Delete' }).click()

      // Should return to create mode
      await expect(
        page.getByRole('heading', { name: 'Create checklist' }),
      ).toBeVisible()
      await expect(page.getByLabel('Checklist name')).toHaveValue('')
    })
  })

  test.describe('Error handling', () => {
    test('shows error when creating a checklist with a duplicate name', async ({
      page,
    }) => {
      // Create a checklist
      await page.getByLabel('Checklist name').fill('Unique name')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Unique name')).toBeVisible()

      // Try to create another with the same name
      await page.getByLabel('Checklist name').fill('Unique name')
      await page.getByRole('button', { name: 'Create checklist' }).click()

      // Should show duplicate error
      await expect(
        page.getByText('A checklist with this name already exists.'),
      ).toBeVisible()
    })

    test('shows error when editing a checklist to a duplicate name', async ({
      page,
    }) => {
      // Create two checklists
      await page.getByLabel('Checklist name').fill('First')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('First')).toBeVisible()

      await page.getByLabel('Checklist name').fill('Second')
      await page.getByRole('button', { name: 'Create checklist' }).click()
      await expect(page.getByText('Second')).toBeVisible()

      // Edit Second to have the same name as First
      const items = page.getByRole('listitem')
      await items
        .filter({ hasText: 'Second' })
        .getByRole('button', { name: 'Edit' })
        .click()
      await page.getByLabel('Checklist name').clear()
      await page.getByLabel('Checklist name').fill('First')
      await page.getByRole('button', { name: 'Save changes' }).click()

      // Should show duplicate error
      await expect(
        page.getByText('A checklist with this name already exists.'),
      ).toBeVisible()
    })
  })
})

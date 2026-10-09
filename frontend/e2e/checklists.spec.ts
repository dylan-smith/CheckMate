import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'

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

// Drags a step by its handle onto another step's place, in small moves like a real pointer.
async function dragStep(page: Page, text: string, targetIndex: number) {
  const handleLocator = page.getByTitle(`Drag to reorder step "${text}"`)
  // The dragged copy from the last drop settles into place before another drag can start.
  await expect(handleLocator).toHaveCount(1)
  const handle = await handleLocator.boundingBox()
  const target = await page.getByRole('listitem').nth(targetIndex).boundingBox()
  if (!handle || !target) {
    throw new Error('Step not on screen')
  }
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    handle.x + handle.width / 2,
    target.y + target.height / 2,
    { steps: 10 },
  )
  await page.mouse.up()
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

  test.describe('Steps', () => {
    // Adds a step from the detail page and waits for it to appear.
    async function addStep(page: Page, text: string) {
      await page.getByLabel('New step').fill(text)
      await page.getByRole('button', { name: 'Add step' }).click()
      await expect(
        page.getByRole('button', { name: `Edit step "${text}"` }),
      ).toBeVisible()
    }

    test('adds, edits and deletes steps, and they persist', async ({
      page,
    }) => {
      await createChecklist(page, 'Morning routine')
      await openChecklist(page, 'Morning routine')
      await expect(page.getByText('No steps yet.')).toBeVisible()

      await addStep(page, 'Make coffee')
      await addStep(page, 'Read email')
      await addStep(page, 'Walk dog')
      await expect(page.getByLabel('New step')).toHaveValue('')

      await page.getByRole('button', { name: 'Edit step "Read email"' }).click()
      await page.getByLabel('Step text').fill('Read the news')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Edit step "Read the news"' }),
      ).toBeVisible()

      await page
        .getByRole('button', { name: 'Delete step "Make coffee"' })
        .click()
      await expect(page.getByText('Make coffee')).toBeHidden()

      await page.reload()

      const steps = page.getByRole('listitem')
      await expect(steps).toHaveCount(2)
      await expect(steps.nth(0)).toContainText('Read the news')
      await expect(steps.nth(1)).toContainText('Walk dog')
    })

    test('reorders steps with the keyboard, and the order persists', async ({
      page,
    }) => {
      await createChecklist(page, 'Evening routine')
      await openChecklist(page, 'Evening routine')

      await addStep(page, 'Wash dishes')
      await addStep(page, 'Brush teeth')
      await addStep(page, 'Read a book')

      await page
        .getByRole('button', { name: 'Move step "Read a book" up' })
        .focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status')).toHaveText(
        'Moved step "Read a book" to position 2 of 3.',
      )
      // Focus stays on the moved step, so pressing Enter again keeps moving it.
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status')).toHaveText(
        'Moved step "Read a book" to position 1 of 3.',
      )

      await page
        .getByRole('button', { name: 'Move step "Wash dishes" down' })
        .click()
      await expect(page.getByRole('status')).toHaveText(
        'Moved step "Wash dishes" to position 3 of 3.',
      )

      await page.reload()

      const steps = page.getByRole('listitem')
      await expect(steps).toHaveCount(3)
      await expect(steps.nth(0)).toContainText('Read a book')
      await expect(steps.nth(1)).toContainText('Brush teeth')
      await expect(steps.nth(2)).toContainText('Wash dishes')
    })

    test('sets prerequisites, rejects a cycle, and they persist', async ({
      page,
    }) => {
      // Picks prerequisites in a form's picker. The step editor and the new step form each have one.
      async function pickPrerequisites(form: string, prerequisites: string[]) {
        await page
          .getByRole('form', { name: form })
          .getByRole('combobox', { name: 'Depends on' })
          .click()
        for (const prerequisite of prerequisites) {
          await page.getByRole('option', { name: prerequisite }).click()
        }
        await page.keyboard.press('Escape')
      }

      // Picks a step's prerequisites in its editor and saves them.
      async function setPrerequisites(text: string, prerequisites: string[]) {
        await page.getByRole('button', { name: `Edit step "${text}"` }).click()
        await pickPrerequisites(`Edit step "${text}"`, prerequisites)
        await page.getByRole('button', { name: 'Save', exact: true }).click()
      }

      await createChecklist(page, 'Deploy')
      await openChecklist(page, 'Deploy')
      await addStep(page, 'Build')
      await addStep(page, 'Test')

      const steps = page.getByRole('listitem')
      await setPrerequisites('Test', ['Build'])
      await expect(steps.nth(1)).toContainText('Depends on: Build')

      // A new step's prerequisites are picked as it's added.
      await page.getByLabel('New step').fill('Release')
      await pickPrerequisites('Add a step', ['Test', 'Build'])
      await page.getByRole('button', { name: 'Add step' }).click()
      await expect(steps.nth(2)).toContainText('Release')
      await expect(steps.nth(2)).toContainText('Depends on: Build, Test')

      // Release already depends on Build, directly and through Test, so this would make a loop.
      await setPrerequisites('Build', ['Release'])
      await expect(page.getByRole('alert')).toContainText(
        'Steps can\'t depend on each other in a loop: "Build" depends on "Release"',
      )
      await page.getByRole('button', { name: 'Cancel' }).click()

      await page.reload()

      await expect(steps).toHaveCount(3)
      await expect(steps.nth(0)).not.toContainText('Depends on')
      await expect(steps.nth(1)).toContainText('Depends on: Build')
      await expect(steps.nth(2)).toContainText('Depends on: Build, Test')
    })

    test('reorders steps by dragging, and the order persists', async ({
      page,
    }) => {
      await createChecklist(page, 'Weekend chores')
      await openChecklist(page, 'Weekend chores')

      await addStep(page, 'Mow lawn')
      await addStep(page, 'Do laundry')
      await addStep(page, 'Buy groceries')

      const steps = page.getByRole('listitem')

      await dragStep(page, 'Buy groceries', 0)
      await expect(page.getByRole('status')).toHaveText(
        'Moved step "Buy groceries" to position 1 of 3.',
      )

      await dragStep(page, 'Buy groceries', 1)
      await expect(page.getByRole('status')).toHaveText(
        'Moved step "Buy groceries" to position 2 of 3.',
      )

      await page.reload()

      await expect(steps).toHaveCount(3)
      await expect(steps.nth(0)).toContainText('Mow lawn')
      await expect(steps.nth(1)).toContainText('Buy groceries')
      await expect(steps.nth(2)).toContainText('Do laundry')
    })

    test('rejects a stale list of step ids', async ({ request }) => {
      const response = await request.post(checklistsApiUrl, {
        data: { name: 'Stale order' },
      })
      expect(response.ok()).toBe(true)
      const { id } = (await response.json()) as { id: number }
      const stepsUrl = `${checklistsApiUrl}/${id}/steps`

      const stepIds: number[] = []
      for (const text of ['One', 'Two']) {
        const stepResponse = await request.post(stepsUrl, { data: { text } })
        expect(stepResponse.ok()).toBe(true)
        stepIds.push(((await stepResponse.json()) as { id: number }).id)
      }

      // A step added since the list was read makes it stale.
      expect(
        (await request.post(stepsUrl, { data: { text: 'Three' } })).ok(),
      ).toBe(true)

      const reorderResponse = await request.put(`${stepsUrl}/order`, {
        data: { stepIds: stepIds.toReversed() },
      })
      expect(reorderResponse.status()).toBe(400)

      const steps = (await (await request.get(stepsUrl)).json()) as {
        text: string
      }[]
      expect(steps.map((step) => step.text)).toEqual(['One', 'Two', 'Three'])
    })

    test('deleting a checklist deletes its steps', async ({ request }) => {
      const response = await request.post(checklistsApiUrl, {
        data: { name: 'Cascade' },
      })
      expect(response.ok()).toBe(true)
      const { id } = (await response.json()) as { id: number }
      const stepsUrl = `${checklistsApiUrl}/${id}/steps`

      const stepResponse = await request.post(stepsUrl, {
        data: { text: 'Orphan' },
      })
      expect(stepResponse.ok()).toBe(true)
      const { id: stepId } = (await stepResponse.json()) as { id: number }

      expect((await request.delete(`${checklistsApiUrl}/${id}`)).ok()).toBe(
        true,
      )

      expect((await request.get(stepsUrl)).status()).toBe(404)
      expect((await request.get(`${stepsUrl}/${stepId}`)).status()).toBe(404)
    })
  })

  test.describe('Fill out', () => {
    // Creates a checklist with steps through the API and returns its id. A step is its text, or its text and type.
    async function createChecklistWithSteps(
      request: APIRequestContext,
      name: string,
      steps: (string | { text: string; type: string })[],
    ) {
      const response = await request.post(checklistsApiUrl, { data: { name } })
      expect(response.ok()).toBe(true)
      const { id } = (await response.json()) as { id: number }
      const stepIds: number[] = []
      for (const step of steps) {
        const stepResponse = await request.post(
          `${checklistsApiUrl}/${id}/steps`,
          { data: typeof step === 'string' ? { text: step } : step },
        )
        expect(stepResponse.ok()).toBe(true)
        stepIds.push(((await stepResponse.json()) as { id: number }).id)
      }
      return { id, stepIds }
    }

    test('saves each tick, survives a reload, and completes read-only', async ({
      page,
      request,
    }) => {
      await createChecklistWithSteps(request, 'Opening up', [
        'Unlock door',
        'Turn on lights',
      ])

      // Filling out starts with one click from the checklists page.
      await page.reload()
      await page.getByRole('button', { name: 'Fill out "Opening up"' }).click()
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)

      const unlock = page.getByRole('checkbox', { name: 'Unlock door' })
      await unlock.check()
      await expect(page.getByText('1 of 2 done')).toBeVisible()
      // Wait for the save to finish, which enables the checkbox again.
      await expect(unlock).toBeEnabled()

      await page.reload()
      await expect(unlock).toBeChecked()
      await expect(
        page.getByRole('checkbox', { name: 'Turn on lights' }),
      ).not.toBeChecked()

      // Every step must be done before the run can be completed.
      await page.getByRole('checkbox', { name: 'Turn on lights' }).check()
      await expect(page.getByText('2 of 2 done')).toBeVisible()

      const runUrl = page.url()
      await page.getByRole('button', { name: 'Complete' }).click()
      // Completing goes back to the checklists page, with a toast that goes away by itself.
      await expect(page).toHaveURL(/\/$/)
      const toast = page.getByRole('alert')
      await expect(toast).toHaveText('Completed "Opening up".')
      // A click elsewhere on the page doesn't dismiss it.
      await page.getByRole('heading', { name: 'Checklists' }).click()
      await expect(toast).toBeVisible()
      await expect(toast).toBeHidden({ timeout: 10_000 })

      // The notice only shows once, not after a reload or going back to this page.
      const fillOut = page.getByRole('button', {
        name: 'Fill out "Opening up"',
      })
      await page.reload()
      await expect(fillOut).toBeVisible()
      await expect(toast).toHaveCount(0)
      await page.goBack()
      await expect(page).toHaveURL(runUrl)
      await page.goForward()
      await expect(fillOut).toBeVisible()
      await expect(toast).toHaveCount(0)

      await page.goto(runUrl)
      await expect(page.getByText(/^Completed /)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Complete' })).toBeHidden()
      await expect(unlock).toBeChecked()
      await expect(unlock).toBeDisabled()
    })

    test('a text step is saved, resumes after a reload, and shows once complete', async ({
      page,
    }) => {
      await createChecklist(page, 'Closing up')
      await openChecklist(page, 'Closing up')
      await page.getByLabel('New step').fill('Lock door')
      await page.getByRole('button', { name: 'Add step' }).click()
      await expect(page.getByText('Lock door')).toBeVisible()
      await page.getByLabel('New step').fill('Cash in till')
      await page.getByRole('combobox', { name: 'Type' }).click()
      await page.getByRole('option', { name: 'Text input' }).click()
      await page.getByRole('button', { name: 'Add step' }).click()
      await expect(page.getByRole('listitem').nth(1)).toContainText(
        'Cash in tillText input',
      )

      await page.reload()
      await expect(page.getByRole('listitem').nth(1)).toContainText(
        'Cash in tillText input',
      )

      await page.getByRole('button', { name: 'Fill out' }).click()
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)
      const cash = page.getByRole('textbox', { name: 'Cash in till' })
      await cash.fill('  $250  ')
      await cash.press('Enter')
      await expect(page.getByText('1 of 2 done')).toBeVisible()
      await expect(cash).toHaveValue('$250')

      await page.reload()
      await expect(cash).toHaveValue('$250')
      await expect(page.getByText('1 of 2 done')).toBeVisible()

      // Clearing the text marks the step not done again.
      await cash.fill('')
      await cash.blur()
      await expect(page.getByText('0 of 2 done')).toBeVisible()
      await cash.fill('$300')
      await cash.blur()
      await expect(page.getByText('1 of 2 done')).toBeVisible()
      await page.getByRole('checkbox', { name: 'Lock door' }).check()
      await expect(page.getByText('2 of 2 done')).toBeVisible()

      const runUrl = page.url()
      await page.getByRole('button', { name: 'Complete' }).click()
      await expect(page.getByRole('alert')).toHaveText(
        'Completed "Closing up".',
      )
      await page.goto(runUrl)
      await expect(page.getByText(/^Completed /)).toBeVisible()
      await expect(cash).toHaveValue('$300')
      await expect(cash).toBeDisabled()
    })

    test('a number step accepts decimals and negatives and rejects anything else', async ({
      page,
      request,
    }) => {
      await createChecklistWithSteps(request, 'Fridge check', [
        { text: 'Fridge temperature', type: 'Number' },
      ])

      await page.reload()
      await page
        .getByRole('button', { name: 'Fill out "Fridge check"' })
        .click()
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)
      const temperature = page.getByRole('textbox', {
        name: 'Fridge temperature',
      })

      await temperature.fill('cold')
      await temperature.blur()
      await expect(
        page.getByText('Enter a number, like 12 or -3.5.'),
      ).toBeVisible()
      await expect(page.getByText('0 of 1 done')).toBeVisible()

      await temperature.fill('-2.75')
      await temperature.press('Enter')
      await expect(page.getByText('1 of 1 done')).toBeVisible()
      await expect(
        page.getByText('Enter a number, like 12 or -3.5.'),
      ).toBeHidden()

      await page.reload()
      await expect(temperature).toHaveValue('-2.75')

      const runUrl = page.url()
      await page.getByRole('button', { name: 'Complete' }).click()
      await expect(page.getByRole('alert')).toHaveText(
        'Completed "Fridge check".',
      )
      await page.goto(runUrl)
      await expect(page.getByText(/^Completed /)).toBeVisible()
      await expect(temperature).toHaveValue('-2.75')
      await expect(temperature).toBeDisabled()
    })

    test('the API rejects a number step value that is not a number', async ({
      request,
    }) => {
      const {
        id,
        stepIds: [stepId],
      } = await createChecklistWithSteps(request, 'Numbers only', [
        { text: 'Count', type: 'Number' },
      ])
      const runResponse = await request.post(`${checklistsApiUrl}/${id}/runs`)
      expect(runResponse.status()).toBe(201)
      const { id: runId } = (await runResponse.json()) as { id: number }
      const stepUrl = `http://localhost:5269/api/runs/${runId}/steps/${stepId}`

      for (const number of ['abc', true, 1.0000001, 1e9, 1e13]) {
        const response = await request.put(stepUrl, { data: { number } })
        expect(response.status(), `${String(number)}`).toBe(400)
      }

      const saved = await request.put(stepUrl, { data: { number: -0.5 } })
      expect(saved.ok()).toBe(true)
      expect(await saved.json()).toMatchObject({
        isDone: true,
        responseNumber: -0.5,
      })
    })

    test('a multiple choice step is picked, resumes, and keeps its pick after the option changes', async ({
      page,
    }) => {
      await createChecklist(page, 'Site visit')
      await openChecklist(page, 'Site visit')
      await page.getByLabel('New step').fill('Weather')
      await page.getByRole('combobox', { name: 'Type' }).click()
      await page.getByRole('option', { name: 'Multiple choice' }).click()
      await page.getByRole('textbox', { name: 'Option 1' }).fill('Sunny')
      await page.getByRole('textbox', { name: 'Option 2' }).fill('Rainy')
      await page.getByRole('button', { name: 'Add option' }).click()
      await page.getByRole('textbox', { name: 'Option 3' }).fill('Snowy')
      await page.getByRole('button', { name: 'Add step' }).click()
      const step = page.getByRole('listitem').first()
      await expect(step).toContainText(
        'WeatherMultiple choice: Sunny, Rainy, Snowy',
      )

      await page.getByRole('button', { name: 'Fill out' }).click()
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)
      const rainy = page.getByRole('radio', { name: 'Rainy' })
      await rainy.check()
      await expect(page.getByText('1 of 1 done')).toBeVisible()
      // Wait for the save to finish, which enables the options again.
      await expect(rainy).toBeEnabled()

      await page.reload()
      await expect(rainy).toBeChecked()

      const runUrl = page.url()
      await page.getByRole('button', { name: 'Complete' }).click()
      await expect(page.getByRole('alert')).toHaveText(
        'Completed "Site visit".',
      )

      // Rename the picked option, and the past run still shows what was picked.
      await openChecklist(page, 'Site visit')
      await page.getByRole('button', { name: 'Edit step "Weather"' }).click()
      await page.getByRole('textbox', { name: 'Option 2' }).fill('Raining')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(step).toContainText(
        'WeatherMultiple choice: Sunny, Raining, Snowy',
      )

      await page.goto(runUrl)
      await expect(page.getByText(/^Completed /)).toBeVisible()
      const picked = page.getByRole('textbox', { name: 'Weather' })
      await expect(picked).toHaveValue('Rainy')
      await expect(picked).toBeDisabled()
    })

    test('the API rejects an option from another step', async ({ request }) => {
      const response = await request.post(checklistsApiUrl, {
        data: { name: 'Two questions' },
      })
      const { id } = (await response.json()) as { id: number }
      const createChoice = async (text: string) => {
        const stepResponse = await request.post(
          `${checklistsApiUrl}/${id}/steps`,
          {
            data: {
              text,
              type: 'Choice',
              options: [{ text: 'Yes' }, { text: 'No' }],
            },
          },
        )
        expect(stepResponse.status()).toBe(201)
        return (await stepResponse.json()) as {
          id: number
          options: { id: number }[]
        }
      }
      const first = await createChoice('First')
      const second = await createChoice('Second')
      const runResponse = await request.post(`${checklistsApiUrl}/${id}/runs`)
      const runId = ((await runResponse.json()) as { id: number }).id

      const rejected = await request.put(
        `http://localhost:5269/api/runs/${runId}/steps/${first.id}`,
        { data: { optionId: second.options[0].id } },
      )

      expect(rejected.status()).toBe(400)
    })

    test('walks a dependency chain, showing each step once its prerequisites are done', async ({
      page,
      request,
    }) => {
      // Prep depends on nothing, Cook on Prep, and Serve on Prep and Cook.
      const {
        id,
        stepIds: [prepId],
      } = await createChecklistWithSteps(request, 'Dinner', ['Prep'])
      const addStep = async (text: string, dependsOnStepIds: number[]) => {
        const response = await request.post(`${checklistsApiUrl}/${id}/steps`, {
          data: { text, dependsOnStepIds },
        })
        expect(response.status()).toBe(201)
        return ((await response.json()) as { id: number }).id
      }
      const cookId = await addStep('Cook', [prepId])
      await addStep('Serve', [prepId, cookId])

      await page.goto(`/checklists/${id}`)
      await page.getByRole('button', { name: 'Fill out' }).click()
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)

      const steps = page.getByRole('list', { name: 'Steps' })
      const prep = page.getByRole('checkbox', { name: 'Prep' })
      const cookBox = page.getByRole('checkbox', { name: 'Cook' })
      const serve = page.getByRole('checkbox', { name: 'Serve' })

      await expect(steps.getByRole('checkbox')).toHaveCount(1)
      await expect(steps.getByRole('checkbox', { name: 'Prep' })).toBeVisible()
      await expect(cookBox).toHaveCount(0)
      await expect(serve).toHaveCount(0)

      await prep.check()
      // Prep stays where it is, and Cook shows up after it.
      await expect(prep).toBeChecked()
      await expect(steps.getByRole('checkbox').nth(1)).toHaveAccessibleName(
        'Cook',
      )
      await expect(serve).toHaveCount(0)

      await cookBox.check()
      await expect(serve).toBeVisible()
      // Prep can't be un-done while Cook, which depends on it, is done.
      await expect(prep).toBeDisabled()

      // The state survives a reload.
      await page.reload()
      await expect(steps.getByRole('checkbox')).toHaveCount(3)
      await expect(serve).not.toBeChecked()

      await serve.check()
      await expect(page.getByText('3 of 3 done')).toBeVisible()
      await expect(serve).toBeEnabled()

      await page.getByRole('button', { name: 'Complete' }).click()
      await expect(page.getByRole('alert')).toHaveText('Completed "Dinner".')
    })

    test('the API enforces the dependency rules', async ({ request }) => {
      const {
        id,
        stepIds: [firstId],
      } = await createChecklistWithSteps(request, 'In order', ['First'])
      const secondResponse = await request.post(
        `${checklistsApiUrl}/${id}/steps`,
        { data: { text: 'Second', dependsOnStepIds: [firstId] } },
      )
      const secondId = ((await secondResponse.json()) as { id: number }).id
      const runResponse = await request.post(`${checklistsApiUrl}/${id}/runs`)
      const run = (await runResponse.json()) as {
        id: number
        steps: { stepId: number; isLocked: boolean }[]
      }
      expect(run.steps.map((step) => step.isLocked)).toEqual([false, true])
      const runUrl = `http://localhost:5269/api/runs/${run.id}`
      const tick = (stepId: number, isDone: boolean) =>
        request.put(`${runUrl}/steps/${stepId}`, { data: { isDone } })

      // The second step is locked until the first is done.
      expect((await tick(secondId, true)).status()).toBe(400)
      expect((await tick(firstId, true)).ok()).toBe(true)
      expect((await tick(secondId, true)).ok()).toBe(true)

      // The first can't be un-done while the second is done.
      expect((await tick(firstId, false)).status()).toBe(400)
      expect((await tick(secondId, false)).ok()).toBe(true)

      // A run can only be completed once every step is done.
      expect((await request.post(`${runUrl}/complete`)).status()).toBe(400)
      expect((await tick(secondId, true)).ok()).toBe(true)
      expect((await request.post(`${runUrl}/complete`)).ok()).toBe(true)
    })

    test('a completed run rejects changes', async ({ request }) => {
      const {
        id,
        stepIds: [stepId],
      } = await createChecklistWithSteps(request, 'Locked run', ['Only step'])
      const runResponse = await request.post(`${checklistsApiUrl}/${id}/runs`)
      expect(runResponse.status()).toBe(201)
      const { id: runId } = (await runResponse.json()) as { id: number }
      const runUrl = `http://localhost:5269/api/runs/${runId}`

      expect(
        (
          await request.put(`${runUrl}/steps/${stepId}`, {
            data: { isDone: true },
          })
        ).ok(),
      ).toBe(true)
      expect((await request.post(`${runUrl}/complete`)).ok()).toBe(true)

      expect(
        (
          await request.put(`${runUrl}/steps/${stepId}`, {
            data: { isDone: false },
          })
        ).status(),
      ).toBe(409)
      expect((await request.post(`${runUrl}/complete`)).status()).toBe(409)
    })

    test('lists past fill-outs, resumes one in progress and shows a completed one read-only', async ({
      page,
      request,
    }) => {
      const {
        id,
        stepIds: [stepId],
      } = await createChecklistWithSteps(request, 'Weekly review', [
        'Clear inbox',
      ])
      const startRun = async () => {
        const response = await request.post(`${checklistsApiUrl}/${id}/runs`)
        expect(response.ok()).toBe(true)
        return `http://localhost:5269/api/runs/${((await response.json()) as { id: number }).id}`
      }
      const completedUrl = await startRun()
      expect(
        (
          await request.put(`${completedUrl}/steps/${stepId}`, {
            data: { isDone: true },
          })
        ).ok(),
      ).toBe(true)
      expect((await request.post(`${completedUrl}/complete`)).ok()).toBe(true)
      await startRun()

      await page.goto(`/checklists/${id}`)
      const fillOuts = page
        .getByRole('list', { name: 'Fill-outs' })
        .getByRole('link')
      await expect(fillOuts).toHaveCount(2)
      // Newest first.
      await expect(fillOuts.nth(0)).toContainText('In progress')
      await expect(fillOuts.nth(1)).toContainText('Completed')

      const clearInbox = page.getByRole('checkbox', { name: 'Clear inbox' })
      await fillOuts.nth(0).click()
      await expect(clearInbox).toBeEnabled()
      await expect(clearInbox).not.toBeChecked()
      await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible()

      await page.goBack()
      await fillOuts.nth(1).click()
      await expect(clearInbox).toBeChecked()
      await expect(clearInbox).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Complete' })).toBeHidden()
    })

    test('deletes fill-outs in progress and completed, from the list and from the fill-out', async ({
      page,
      request,
    }) => {
      const {
        id,
        stepIds: [stepId],
      } = await createChecklistWithSteps(request, 'Cleanup', ['Only step'])
      const startRun = async () => {
        const response = await request.post(`${checklistsApiUrl}/${id}/runs`)
        expect(response.ok()).toBe(true)
        return (await response.json()) as { id: number; clientKey: string }
      }
      const { id: completedId } = await startRun()
      // Every step must be done before a run can be completed.
      expect(
        (
          await request.put(
            `http://localhost:5269/api/runs/${completedId}/steps/${stepId}`,
            { data: { isDone: true } },
          )
        ).ok(),
      ).toBe(true)
      expect(
        (
          await request.post(
            `http://localhost:5269/api/runs/${completedId}/complete`,
          )
        ).ok(),
      ).toBe(true)
      const { id: inProgressId, clientKey: inProgressKey } = await startRun()

      await page.goto(`/checklists/${id}`)
      const fillOuts = page.getByRole('list', { name: 'Fill-outs' })
      await expect(fillOuts.getByRole('link')).toHaveCount(2)

      // The completed one, from the list.
      await fillOuts
        .getByRole('listitem')
        .filter({ hasText: 'Completed' })
        .getByRole('button', { name: /^Delete fill-out/ })
        .click()
      await expect(fillOuts.getByRole('link')).toHaveCount(1)
      await expect(fillOuts.getByRole('link')).toContainText('In progress')

      // The one in progress, from its own page.
      await fillOuts.getByRole('link').click()
      await expect(page).toHaveURL(new RegExp(`/runs/${inProgressKey}$`))
      await expect(
        page.getByRole('checkbox', { name: 'Only step' }),
      ).toBeEnabled()
      await page
        .getByRole('button', { name: 'Delete fill-out', exact: true })
        .click()
      await expect(page).toHaveURL(new RegExp(`/checklists/${id}$`))
      await expect(page.getByText('No fill-outs yet.')).toBeVisible()

      // Both are gone for good. The one deleted from its page goes from the API once the device has synced.
      await page.reload()
      await expect(page.getByText('No fill-outs yet.')).toBeVisible()
      for (const runId of [completedId, inProgressId]) {
        await expect
          .poll(async () =>
            (
              await request.get(`http://localhost:5269/api/runs/${runId}`)
            ).status(),
          )
          .toBe(404)
      }
    })

    test('a past run keeps the step text after the step is edited or deleted', async ({
      page,
      request,
    }) => {
      const {
        id,
        stepIds: [editedId, deletedId],
      } = await createChecklistWithSteps(request, 'History', [
        'Original text',
        'Removed later',
      ])
      const runResponse = await request.post(`${checklistsApiUrl}/${id}/runs`)
      expect(runResponse.ok()).toBe(true)
      const { id: runId, clientKey } = (await runResponse.json()) as {
        id: number
        clientKey: string
      }
      // Done before it's deleted, since a deleted step that wasn't done is left out of an open run.
      expect(
        (
          await request.put(
            `http://localhost:5269/api/runs/${runId}/steps/${deletedId}`,
            { data: { isDone: true } },
          )
        ).ok(),
      ).toBe(true)

      const stepsUrl = `${checklistsApiUrl}/${id}/steps`
      expect(
        (
          await request.put(`${stepsUrl}/${editedId}`, {
            data: { text: 'New text' },
          })
        ).ok(),
      ).toBe(true)
      expect((await request.delete(`${stepsUrl}/${deletedId}`)).ok()).toBe(true)

      // A link from before fill-outs had keys still opens the fill-out, by its key.
      await page.goto(`/runs/${runId}`)
      await expect(page).toHaveURL(new RegExp(`/runs/${clientKey}$`))
      await expect(
        page.getByRole('checkbox', { name: 'Original text' }),
      ).toBeVisible()
      await expect(
        page.getByRole('checkbox', { name: 'Removed later' }),
      ).toBeVisible()
      await expect(page.getByText('New text')).toBeHidden()
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

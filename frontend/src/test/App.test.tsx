import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { trackEvent, trackException, trackPageView } from '../telemetry'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))

const unreachableMessage =
  "Can't reach CheckMate right now. It may be updating, so try again in a minute."

// The checklist page also loads the checklist's fill-outs, which runsHandler answers. It returns none
// unless a test is about them.
function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  runsHandler: () => Promise<Response> = async () => jsonResponse([]),
) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      return init?.method === undefined &&
        /\/api\/checklists\/\d+\/runs$/.test(url)
        ? runsHandler()
        : handler(url, init)
    })
}

// The checklist page only loaded the checklist and its fill-outs, and sent nothing else.
function expectOnlyLoaded() {
  expect(fetch).toHaveBeenCalledTimes(2)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('App', () => {
  describe('static content', () => {
    it('renders heading and subtitle', async () => {
      mockFetch(async () => jsonResponse([]))

      renderAt('/')

      expect(
        screen.getByRole('heading', { level: 1, name: 'CheckMate' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Build a checklist once, run it every time, and keep a record of every run.',
        ),
      ).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
    })

    it('links the logo to the checklists page', async () => {
      mockFetch(async () => jsonResponse([]))

      renderAt('/')

      expect(screen.getByRole('link', { name: 'CheckMate' })).toHaveAttribute(
        'href',
        '/',
      )
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
    })
  })

  describe('checklists page', () => {
    it('shows loading state then displays checklists as links', async () => {
      mockFetch(async () =>
        jsonResponse([
          { id: 1, name: 'Grocery list' },
          { id: 2, name: 'Daily chores' },
        ]),
      )

      renderAt('/')

      expect(screen.getByLabelText('Loading')).toBeInTheDocument()

      await waitFor(() => {
        expect(
          screen.getByRole('link', { name: 'Grocery list' }),
        ).toHaveAttribute('href', '/checklists/1')
      })
      expect(
        screen.getByRole('link', { name: 'Daily chores' }),
      ).toHaveAttribute('href', '/checklists/2')
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
    })

    it('shows "No checklists yet." when the list is empty', async () => {
      mockFetch(async () => jsonResponse([]))

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })
    })

    it('shows error message when loading fails', async () => {
      mockFetch(async () => new Response(null, { status: 500 }))

      renderAt('/')

      await waitFor(() => {
        expect(
          screen.getByText('Unable to load checklists.'),
        ).toBeInTheDocument()
      })
    })

    it('shows error message when the API is unreachable', async () => {
      mockFetch(async () => {
        throw new TypeError('Failed to fetch')
      })

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText(unreachableMessage)).toBeInTheDocument()
      })
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'load',
      })
    })

    it('renders the create checklist form', async () => {
      mockFetch(async () => jsonResponse([]))

      renderAt('/')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Create checklist' }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Create checklist' }),
      ).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
    })

    it('opens a checklist when it is clicked', async () => {
      const user = userEvent.setup()
      mockFetch(async (url) =>
        url.endsWith('/api/checklists/1')
          ? jsonResponse({ id: 1, name: 'Grocery list', steps: [] })
          : jsonResponse([{ id: 1, name: 'Grocery list' }]),
      )

      renderAt('/')

      await user.click(
        await screen.findByRole('link', { name: 'Grocery list' }),
      )

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Grocery list' }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('Grocery list')
    })
  })

  describe('page views', () => {
    it('tracks one for the first load and one for each route change', async () => {
      const user = userEvent.setup()
      mockFetch(async (url) =>
        url.endsWith('/api/checklists/1')
          ? jsonResponse({ id: 1, name: 'Grocery list', steps: [] })
          : jsonResponse([{ id: 1, name: 'Grocery list' }]),
      )

      renderAt('/')

      expect(trackPageView).toHaveBeenCalledTimes(1)

      await user.click(
        await screen.findByRole('link', { name: 'Grocery list' }),
      )
      await user.click(
        await screen.findByRole('link', { name: /Back to checklists/ }),
      )

      expect(trackPageView).toHaveBeenCalledTimes(3)
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
    })
  })

  describe('creating a checklist', () => {
    it('sends a POST request and refreshes the list', async () => {
      const user = userEvent.setup()
      let callCount = 0

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse({ id: 1, name: 'New list' }, 201)
        }
        callCount++
        if (callCount <= 1) {
          return jsonResponse([])
        }
        return jsonResponse([{ id: 1, name: 'New list' }])
      })

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'New list',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(screen.getByText('New list')).toBeInTheDocument()
      })
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New list' }),
        }),
      )
      expect(trackEvent).toHaveBeenCalledWith('ChecklistCreated')
    })

    it('shows error for duplicate name (409 conflict) without reporting it', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            { message: 'A checklist with this name already exists.' },
            409,
          )
        }
        return jsonResponse([{ id: 1, name: 'Existing' }])
      })

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('Existing')).toBeInTheDocument()
      })

      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'Existing',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(
          screen.getByText('A checklist with this name already exists.'),
        ).toBeInTheDocument()
      })
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows generic error when create fails with non-409 error', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return new Response(null, { status: 500 })
        }
        return jsonResponse([])
      })

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'Test',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(
          screen.getByText('Unable to save checklist.'),
        ).toBeInTheDocument()
      })
    })

    it('shows error when the API is unreachable during create', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          throw new TypeError('Failed to fetch')
        }
        return jsonResponse([])
      })

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'Test',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(screen.getByText(unreachableMessage)).toBeInTheDocument()
      })
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'save',
      })
      expect(trackEvent).not.toHaveBeenCalled()
    })

    it('trims whitespace from name before submitting', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse({ id: 1, name: 'Trimmed' }, 201)
        }
        return jsonResponse([])
      })

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        '  Trimmed  ',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/checklists$/),
          expect.objectContaining({
            body: JSON.stringify({ name: 'Trimmed' }),
          }),
        )
      })
    })

    it('shows error when submitting only whitespace', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse([]))

      renderAt('/')

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        '   ',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(
          screen.getByText('Checklist name is required.'),
        ).toBeInTheDocument()
      })
    })
  })

  describe('checklist detail page', () => {
    it('loads the checklist from a deep link', async () => {
      mockFetch(async () =>
        jsonResponse({ id: 7, name: 'Packing list', steps: [] }),
      )

      renderAt('/checklists/7')

      expect(screen.getByLabelText('Loading')).toBeInTheDocument()
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Packing list' }),
      ).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/7$/),
      )
      expect(
        screen.getByRole('link', { name: /Back to checklists/ }),
      ).toHaveAttribute('href', '/')
    })

    it('shows not found when the checklist does not exist', async () => {
      mockFetch(async () => new Response(null, { status: 404 }))

      renderAt('/checklists/99')

      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Page not found',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          "That checklist doesn't exist. It may have been deleted.",
        ),
      ).toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows not found without calling the API for an invalid id', () => {
      mockFetch(async () => jsonResponse([]))

      renderAt('/checklists/abc')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Page not found' }),
      ).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('shows error message when the API is unreachable', async () => {
      mockFetch(async () => {
        throw new TypeError('Failed to fetch')
      })

      renderAt('/checklists/1')

      expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'load',
      })
    })

    it('shows error message when loading fails', async () => {
      mockFetch(async () => new Response(null, { status: 500 }))

      renderAt('/checklists/1')

      expect(
        await screen.findByText('Unable to load checklist.'),
      ).toBeInTheDocument()
    })
  })

  describe('renaming a checklist', () => {
    it('sends a PUT request and shows the new name', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({ id: 1, name: 'Updated list' })
        }
        return jsonResponse({ id: 1, name: 'My list', steps: [] })
      })

      renderAt('/checklists/1')

      const input = await screen.findByLabelText('Checklist name', {
        exact: false,
      })
      await user.clear(input)
      await user.type(input, '  Updated list  ')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Updated list' }),
      ).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated list' }),
        }),
      )
      expect(trackEvent).toHaveBeenCalledWith('ChecklistUpdated')
    })

    it('shows error for 409 conflict and keeps the old name', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse(
            { message: 'A checklist with this name already exists.' },
            409,
          )
        }
        return jsonResponse({ id: 1, name: 'My list', steps: [] })
      })

      renderAt('/checklists/1')

      const input = await screen.findByLabelText('Checklist name', {
        exact: false,
      })
      await user.clear(input)
      await user.type(input, 'Duplicate')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(
        await screen.findByText('A checklist with this name already exists.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 2, name: 'My list' }),
      ).toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows error when submitting only whitespace', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse({ id: 1, name: 'My list', steps: [] }))

      renderAt('/checklists/1')

      const input = await screen.findByLabelText('Checklist name', {
        exact: false,
      })
      await user.clear(input)
      await user.type(input, '   ')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(
        await screen.findByText('Checklist name is required.'),
      ).toBeInTheDocument()
      expectOnlyLoaded()
    })
  })

  describe('deleting a checklist', () => {
    it('sends a DELETE request and goes back to the list', async () => {
      const user = userEvent.setup()

      mockFetch(async (url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        return url.endsWith('/api/checklists/1')
          ? jsonResponse({ id: 1, name: 'To delete', steps: [] })
          : jsonResponse([])
      })

      renderAt('/checklists/1')

      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      expect(await screen.findByText('No checklists yet.')).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1$/),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(trackEvent).toHaveBeenCalledWith('ChecklistDeleted')
    })

    it('treats 404 as a successful delete', async () => {
      const user = userEvent.setup()

      mockFetch(async (url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 404 })
        }
        return url.endsWith('/api/checklists/1')
          ? jsonResponse({ id: 1, name: 'Already gone', steps: [] })
          : jsonResponse([])
      })

      renderAt('/checklists/1')

      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      expect(await screen.findByText('No checklists yet.')).toBeInTheDocument()
      expect(
        screen.queryByText('Unable to delete checklist.'),
      ).not.toBeInTheDocument()
    })

    it('shows error and stays on the page when delete fails', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 500 })
        }
        return jsonResponse({ id: 1, name: 'Persistent', steps: [] })
      })

      renderAt('/checklists/1')

      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      expect(
        await screen.findByText('Unable to delete checklist.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 2, name: 'Persistent' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
    })

    it('shows error when the API is unreachable during delete', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          throw new TypeError('Failed to fetch')
        }
        return jsonResponse({ id: 1, name: 'Persistent', steps: [] })
      })

      renderAt('/checklists/1')

      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'delete',
      })
    })
  })

  describe('checklist steps', () => {
    const checklistWithSteps = {
      id: 1,
      name: 'Morning',
      steps: [
        { id: 10, text: 'Make coffee', type: 'Checkbox', sortOrder: 0 },
        { id: 11, text: 'Read email', type: 'Checkbox', sortOrder: 1 },
      ],
    }

    it('lists the steps in order', async () => {
      mockFetch(async () => jsonResponse(checklistWithSteps))

      renderAt('/checklists/1')

      const steps = await screen.findAllByRole('listitem')
      expect(steps).toHaveLength(2)
      expect(steps[0]).toHaveTextContent('Make coffee')
      expect(steps[1]).toHaveTextContent('Read email')
    })

    it('shows "No steps yet." when there are none', async () => {
      mockFetch(async () => jsonResponse({ id: 1, name: 'Empty', steps: [] }))

      renderAt('/checklists/1')

      expect(await screen.findByText('No steps yet.')).toBeInTheDocument()
    })

    it('adds a trimmed step at the end and clears the input', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            { id: 12, text: 'Walk dog', type: 'Checkbox', sortOrder: 2 },
            201,
          )
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      const input = await screen.findByLabelText('New step')
      await user.type(input, '  Walk dog  ')
      await user.click(screen.getByRole('button', { name: 'Add step' }))

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(3)
      })
      expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('Walk dog')
      expect(input).toHaveValue('')
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Walk dog', type: 'Checkbox' }),
        }),
      )
      expect(trackEvent).toHaveBeenCalledWith('StepAdded')
    })

    it('shows error when adding only whitespace', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse(checklistWithSteps))

      renderAt('/checklists/1')

      await user.type(await screen.findByLabelText('New step'), '   ')
      await user.click(screen.getByRole('button', { name: 'Add step' }))

      expect(
        await screen.findByText('Step text is required.'),
      ).toBeInTheDocument()
      expectOnlyLoaded()
    })

    it('shows error when adding a step fails', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return new Response(null, { status: 500 })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.type(await screen.findByLabelText('New step'), 'Walk dog')
      await user.click(screen.getByRole('button', { name: 'Add step' }))

      expect(
        await screen.findByText('Unable to save step.'),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'addStep',
      })
    })

    it('edits a step', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({
            id: 10,
            text: 'Make tea',
            type: 'Checkbox',
            sortOrder: 0,
          })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', { name: 'Edit step "Make coffee"' }),
      )
      const input = screen.getByLabelText('Step text', { exact: false })
      expect(input).toHaveValue('Make coffee')
      await user.clear(input)
      await user.type(input, ' Make tea ')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Make tea')).toBeInTheDocument()
      expect(
        screen.queryByLabelText('Step text', { exact: false }),
      ).not.toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps\/10$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ text: 'Make tea', type: 'Checkbox' }),
        }),
      )
      expect(trackEvent).toHaveBeenCalledWith('StepUpdated')
    })

    it('cancels editing without saving', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse(checklistWithSteps))

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', { name: 'Edit step "Make coffee"' }),
      )
      await user.type(
        screen.getByLabelText('Step text', { exact: false }),
        ' later',
      )
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('Make coffee')).toBeInTheDocument()
      expectOnlyLoaded()
    })

    it('shows error when editing a step to only whitespace', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse(checklistWithSteps))

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', { name: 'Edit step "Make coffee"' }),
      )
      const input = screen.getByLabelText('Step text', { exact: false })
      await user.clear(input)
      await user.type(input, '  ')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByText('Step text is required.'),
      ).toBeInTheDocument()
      expectOnlyLoaded()

      // Canceling the edit clears its error along with the field.
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(
        screen.queryByText('Step text is required.'),
      ).not.toBeInTheDocument()
      expect(screen.getByText('Make coffee')).toBeInTheDocument()
    })

    it('deletes a step', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', {
          name: 'Delete step "Make coffee"',
        }),
      )

      await waitFor(() => {
        expect(screen.queryByText('Make coffee')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Read email')).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps\/10$/),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(trackEvent).toHaveBeenCalledWith('StepDeleted')
    })

    it('shows error when the API is unreachable during step delete', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          throw new TypeError('Failed to fetch')
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', {
          name: 'Delete step "Make coffee"',
        }),
      )

      expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
      expect(screen.getByText('Make coffee')).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'deleteStep',
      })
    })

    it("can't move the first step up or the last step down", async () => {
      mockFetch(async () => jsonResponse(checklistWithSteps))

      renderAt('/checklists/1')

      expect(
        await screen.findByRole('button', {
          name: 'Move step "Make coffee" up',
        }),
      ).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Move step "Make coffee" down' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Move step "Read email" up' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Move step "Read email" down' }),
      ).toBeDisabled()
    })

    it('moves a step with the keyboard and keeps focus on it', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse([
            { id: 11, text: 'Read email', type: 'Checkbox', sortOrder: 0 },
            { id: 10, text: 'Make coffee', type: 'Checkbox', sortOrder: 1 },
          ])
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      const moveDown = await screen.findByRole('button', {
        name: 'Move step "Make coffee" down',
      })
      moveDown.focus()
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
          'Read email',
        )
      })
      expect(screen.getAllByRole('listitem')[1]).toHaveTextContent(
        'Make coffee',
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps\/order$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ stepIds: [11, 10] }),
        }),
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        'Moved step "Make coffee" to position 2 of 2.',
      )
      // The step is now last, so focus moves to its other button.
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Move step "Make coffee" up' }),
        ).toHaveFocus()
      })
      expect(trackEvent).toHaveBeenCalledWith('StepsReordered')
    })

    it('asks to reload without reporting it when the steps changed elsewhere', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return new Response(null, { status: 400 })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', {
          name: 'Move step "Read email" up',
        }),
      )

      expect(
        await screen.findByText(
          'The steps have changed since this page loaded. Reload the page and try again.',
        ),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
        'Make coffee',
      )
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows error when reordering steps fails', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return new Response(null, { status: 500 })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', {
          name: 'Move step "Read email" up',
        }),
      )

      expect(
        await screen.findByText('Unable to reorder steps.'),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
        'Make coffee',
      )
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'reorderSteps',
      })
    })

    it('adds a text step with the type picker and labels it', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            { id: 12, text: 'Notes', type: 'Text', sortOrder: 2 },
            201,
          )
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.type(await screen.findByLabelText('New step'), 'Notes')
      await user.click(screen.getByRole('combobox', { name: 'Type' }))
      await user.click(screen.getByRole('option', { name: 'Text input' }))
      await user.click(screen.getByRole('button', { name: 'Add step' }))

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(3)
      })
      expect(screen.getAllByRole('listitem')[2]).toHaveTextContent(
        'NotesText input',
      )
      // Checkbox steps aren't labelled with their type.
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
        /^Make coffee/,
      )
      expect(screen.getAllByRole('listitem')[0]).not.toHaveTextContent(
        'Checkbox',
      )
      // The picker goes back to Checkbox for the next step.
      expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent(
        'Checkbox',
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Notes', type: 'Text' }),
        }),
      )
    })

    it("changes a step's type", async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({
            id: 10,
            text: 'Make coffee',
            type: 'Text',
            sortOrder: 0,
          })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', { name: 'Edit step "Make coffee"' }),
      )
      const typePicker = screen.getAllByRole('combobox', { name: 'Type' })[0]
      expect(typePicker).toHaveTextContent('Checkbox')
      await user.click(typePicker)
      await user.click(screen.getByRole('option', { name: 'Text input' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
          'Make coffeeText input',
        )
      })
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps\/10$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ text: 'Make coffee', type: 'Text' }),
        }),
      )
    })

    it('keeps the steps after renaming the checklist', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({ id: 1, name: 'Evening' })
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      const input = await screen.findByLabelText('Checklist name', {
        exact: false,
      })
      await user.clear(input)
      await user.type(input, 'Evening')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Evening' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Make coffee')).toBeInTheDocument()
    })
  })

  describe('filling out a checklist', () => {
    const run = {
      id: 5,
      checklistId: 3,
      checklistName: 'Morning',
      startedAt: '2026-10-06T08:00:00Z',
      completedAt: null,
      steps: [
        {
          stepId: 11,
          text: 'Make coffee',
          type: 'Checkbox',
          isDone: false,
          completedAt: null,
          responseText: null,
        },
        {
          stepId: 12,
          text: 'Read email',
          type: 'Checkbox',
          isDone: true,
          completedAt: null,
          responseText: null,
        },
      ],
    }

    it('starts a run from the checklist page and opens it', async () => {
      const user = userEvent.setup()
      const fetchMock = mockFetch(async (url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(run, 201)
        }
        if (url.endsWith('/api/runs/5')) {
          return jsonResponse(run)
        }
        return jsonResponse({ id: 3, name: 'Morning', steps: [] })
      })

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('button', { name: 'Fill out' }))

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).not.toBeChecked()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/3\/runs$/),
        { method: 'POST' },
      )
      expect(trackEvent).toHaveBeenCalledWith('RunStarted')
    })

    it('starts a run straight from the checklists page', async () => {
      const user = userEvent.setup()
      const fetchMock = mockFetch(async (url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(run, 201)
        }
        if (url.endsWith('/api/runs/5')) {
          return jsonResponse(run)
        }
        return jsonResponse([
          { id: 2, name: 'Evening' },
          { id: 3, name: 'Morning' },
        ])
      })

      renderAt('/')
      await user.click(
        await screen.findByRole('button', { name: 'Fill out "Morning"' }),
      )

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/3\/runs$/),
        { method: 'POST' },
      )
      expect(trackEvent).toHaveBeenCalledWith('RunStarted')
    })

    it('shows an error on the checklists page when a run cannot be started', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? new Response(null, { status: 500 })
          : jsonResponse([{ id: 3, name: 'Morning' }]),
      )

      renderAt('/')
      await user.click(
        await screen.findByRole('button', { name: 'Fill out "Morning"' }),
      )

      expect(
        await screen.findByText('Unable to start filling out the checklist.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Fill out "Morning"' }),
      ).toBeEnabled()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'startRun',
      })
    })

    it('shows an error when a run cannot be started', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? new Response(null, { status: 500 })
          : jsonResponse({ id: 3, name: 'Morning', steps: [] }),
      )

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('button', { name: 'Fill out' }))

      expect(
        await screen.findByText('Unable to start filling out the checklist.'),
      ).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'startRun',
      })
    })

    it('shows the run with each step and a link back to the checklist', async () => {
      mockFetch(async () => jsonResponse(run))

      renderAt('/runs/5')

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Morning' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Read email' })).toBeChecked()
      expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: /Back to checklist/ }),
      ).toHaveAttribute('href', '/checklists/3')
    })

    it('saves a tick straight away', async () => {
      const user = userEvent.setup()
      const fetchMock = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({
              stepId: 11,
              text: 'Make coffee',
              isDone: true,
              completedAt: '2026-10-06T08:05:00Z',
            })
          : jsonResponse(run),
      )

      renderAt('/runs/5')
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).toBeChecked()
      expect(await screen.findByText('2 of 2 done')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/runs\/5\/steps\/11$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ isDone: true }),
        }),
      )
    })

    it('waits for a tick to save before completing', async () => {
      const user = userEvent.setup()
      const requests: string[] = []
      let finishTick: (response: Response) => void = () => {}
      mockFetch(async (url, init) => {
        if (!url.includes('/api/runs/5')) {
          // The checklists page, which completing goes back to.
          return jsonResponse([])
        }
        requests.push(init?.method ?? 'GET')
        if (init?.method === 'PUT') {
          return new Promise<Response>((resolve) => {
            finishTick = resolve
          })
        }
        return init?.method === 'POST'
          ? jsonResponse({ ...run, completedAt: '2026-10-06T08:30:00Z' })
          : jsonResponse(run)
      })

      renderAt('/runs/5')
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )
      await user.click(screen.getByRole('button', { name: 'Complete' }))
      expect(requests).toEqual(['GET', 'PUT'])

      finishTick(
        jsonResponse({
          ...run.steps[0],
          isDone: true,
          completedAt: '2026-10-06T08:05:00Z',
        }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Completed "Morning".',
      )
      expect(requests).toEqual(['GET', 'PUT', 'POST'])
    })

    it('undoes a tick that fails to save', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? new Response(null, { status: 500 })
          : jsonResponse(run),
      )

      renderAt('/runs/5')
      await user.click(
        await screen.findByRole('checkbox', { name: 'Read email' }),
      )

      expect(
        await screen.findByText('Unable to save step.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Read email' })).toBeChecked()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'saveRunStep',
      })
    })

    it('completes the run and goes back to the checklists page', async () => {
      const user = userEvent.setup()
      const completed = { ...run, completedAt: '2026-10-06T08:30:00Z' }
      mockFetch(async (url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(completed)
        }
        return url.endsWith('/api/runs/5')
          ? jsonResponse(run)
          : jsonResponse([])
      })

      renderAt('/runs/5')
      await user.click(await screen.findByRole('button', { name: 'Complete' }))

      expect(await screen.findByText('No checklists yet.')).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/runs\/5\/complete$/),
        expect.objectContaining({ method: 'POST' }),
      )
      expect(trackEvent).toHaveBeenCalledWith('RunCompleted')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Completed "Morning".',
      )

      // A click elsewhere on the page doesn't dismiss it.
      await user.click(screen.getByRole('heading', { name: 'Checklists' }))
      expect(screen.getByRole('alert')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })

    it('shows the run as complete when it was completed elsewhere', async () => {
      const user = userEvent.setup()
      const completed = { ...run, completedAt: '2026-10-06T08:30:00Z' }
      let loads = 0
      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse(
            { message: "This run is complete and can't be changed." },
            409,
          )
        }
        loads += 1
        return jsonResponse(loads === 1 ? run : completed)
      })

      renderAt('/runs/5')
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      expect(
        await screen.findByText("This run is complete and can't be changed."),
      ).toBeInTheDocument()
      expect(
        await screen.findByText(/^Completed /, { selector: 'div' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).not.toBeChecked()
      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).toBeDisabled()
      expect(trackException).not.toHaveBeenCalled()
    })

    it('keeps the run read-only and offers a reload when reloading after a 409 fails', async () => {
      const user = userEvent.setup()
      const completed = { ...run, completedAt: '2026-10-06T08:30:00Z' }
      let loads = 0
      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse(
            { message: "This run is complete and can't be changed." },
            409,
          )
        }
        loads += 1
        if (loads === 2) {
          throw new TypeError('Failed to fetch')
        }
        return jsonResponse(loads === 1 ? run : completed)
      })

      renderAt('/runs/5')
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      const reload = await screen.findByRole('button', { name: 'Reload' })
      expect(
        screen.getByText("This run is complete and can't be changed."),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'Complete' }),
      ).not.toBeInTheDocument()

      await user.click(reload)

      expect(
        await screen.findByText(/^Completed /, { selector: 'div' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Reload' }),
      ).not.toBeInTheDocument()
    })

    describe('text steps', () => {
      const notesStep = {
        stepId: 13,
        text: 'Notes',
        type: 'Text',
        isDone: false,
        completedAt: null,
        responseText: null,
      }
      const runWithText = { ...run, steps: [...run.steps, notesStep] }
      const savedNotes = {
        ...notesStep,
        isDone: true,
        completedAt: '2026-10-06T08:10:00Z',
        responseText: 'All good',
      }

      it('saves the text when the field loses focus', async () => {
        const user = userEvent.setup()
        const fetchMock = mockFetch(async (_url, init) =>
          init?.method === 'PUT'
            ? jsonResponse(savedNotes)
            : jsonResponse(runWithText),
        )

        renderAt('/runs/5')
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          '  All good  ',
        )
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await user.tab()

        expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
          'All good',
        )
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/runs\/5\/steps\/13$/),
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ text: '  All good  ' }),
          }),
        )
      })

      it('saves the text when Enter is pressed, and not again if unchanged', async () => {
        const user = userEvent.setup()
        const fetchMock = mockFetch(async (_url, init) =>
          init?.method === 'PUT'
            ? jsonResponse(savedNotes)
            : jsonResponse(runWithText),
        )

        renderAt('/runs/5')
        const field = await screen.findByRole('textbox', { name: 'Notes' })
        await user.type(field, 'All good{Enter}')

        expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
        expect(field).toHaveFocus()
        await user.tab()
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })

      it('does not save when the field is left unchanged', async () => {
        const user = userEvent.setup()
        const fetchMock = mockFetch(async () => jsonResponse(runWithText))

        renderAt('/runs/5')
        await user.click(await screen.findByRole('textbox', { name: 'Notes' }))
        await user.tab()

        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it('keeps the typed text when it fails to save', async () => {
        const user = userEvent.setup()
        mockFetch(async (_url, init) =>
          init?.method === 'PUT'
            ? new Response(null, { status: 500 })
            : jsonResponse(runWithText),
        )

        renderAt('/runs/5')
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        await user.tab()

        expect(
          await screen.findByText('Unable to save step.'),
        ).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
          'All good',
        )
        expect(screen.getByText('1 of 3 done')).toBeInTheDocument()
      })

      it('shows the saved text read-only once the run is complete', async () => {
        mockFetch(async () =>
          jsonResponse({
            ...run,
            completedAt: '2026-10-06T08:30:00Z',
            steps: [savedNotes],
          }),
        )

        renderAt('/runs/5')

        const field = await screen.findByRole('textbox', { name: 'Notes' })
        expect(field).toHaveValue('All good')
        expect(field).toBeDisabled()
        expect(field).toHaveAccessibleDescription(
          `Done ${new Date('2026-10-06T08:10:00Z').toLocaleString()}`,
        )
      })

      it('saves the text first when Complete is clicked straight from the field', async () => {
        const user = userEvent.setup()
        const requests: string[] = []
        const completed = {
          ...runWithText,
          completedAt: '2026-10-06T08:30:00Z',
          steps: [...run.steps, savedNotes],
        }
        const fetchMock = mockFetch(async (url, init) => {
          if (!url.includes('/api/runs/5')) {
            // The checklists page, which completing goes back to.
            return jsonResponse([])
          }
          requests.push(init?.method ?? 'GET')
          if (init?.method === 'PUT') {
            return jsonResponse(savedNotes)
          }
          return init?.method === 'POST'
            ? jsonResponse(completed)
            : jsonResponse(runWithText)
        })

        renderAt('/runs/5')
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        // Leaving the field starts its save, which is still under way when the click lands.
        await user.click(screen.getByRole('button', { name: 'Complete' }))

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Completed "Morning".',
        )
        expect(requests).toEqual(['GET', 'PUT', 'POST'])
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/runs\/5\/steps\/13$/),
          expect.objectContaining({
            body: JSON.stringify({ text: 'All good' }),
          }),
        )
      })

      it('tries a failed save again before completing', async () => {
        const user = userEvent.setup()
        let puts = 0
        const completed = {
          ...runWithText,
          completedAt: '2026-10-06T08:30:00Z',
          steps: [...run.steps, savedNotes],
        }
        const fetchMock = mockFetch(async (url, init) => {
          if (!url.includes('/api/runs/5')) {
            // The checklists page, which completing goes back to.
            return jsonResponse([])
          }
          if (init?.method === 'PUT') {
            puts += 1
            return puts === 1
              ? new Response(null, { status: 500 })
              : jsonResponse(savedNotes)
          }
          return init?.method === 'POST'
            ? jsonResponse(completed)
            : jsonResponse(runWithText)
        })

        renderAt('/runs/5')
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        await user.tab()
        expect(
          await screen.findByText('Unable to save step.'),
        ).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Complete' }))

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Completed "Morning".',
        )
        expect(puts).toBe(2)
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/runs\/5\/complete$/),
          { method: 'POST' },
        )
      })

      it("keeps a failed tick's error instead of saving text when completing", async () => {
        const user = userEvent.setup()
        let finishTick: (response: Response) => void = () => {}
        let textPuts = 0
        const fetchMock = mockFetch(async (url, init) => {
          if (init?.method === 'PUT' && url.endsWith('/steps/11')) {
            return new Promise<Response>((resolve) => {
              finishTick = resolve
            })
          }
          if (init?.method === 'PUT') {
            textPuts += 1
            return textPuts === 1
              ? new Response(null, { status: 500 })
              : jsonResponse(savedNotes)
          }
          return jsonResponse(runWithText)
        })

        renderAt('/runs/5')
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        // Leaving the field saves the text, which fails, while the tick's save is still under way.
        await user.click(screen.getByRole('checkbox', { name: 'Make coffee' }))
        await screen.findByText('Unable to save step.')
        await user.click(screen.getByRole('button', { name: 'Complete' }))
        finishTick(new Response(null, { status: 500 }))

        await waitFor(() => {
          expect(
            screen.getByRole('checkbox', { name: 'Make coffee' }),
          ).not.toBeChecked()
        })
        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
        })
        expect(screen.getByText('Unable to save step.')).toBeInTheDocument()
        expect(textPuts).toBe(1)
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
        ).toBe(false)
      })

      it('does not complete while the text still cannot be saved', async () => {
        const user = userEvent.setup()
        const fetchMock = mockFetch(async (_url, init) =>
          init?.method === 'PUT'
            ? new Response(null, { status: 500 })
            : jsonResponse(runWithText),
        )

        renderAt('/runs/5')
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        await user.tab()
        expect(
          await screen.findByText('Unable to save step.'),
        ).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Complete' }))

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
        })
        expect(screen.getByText('Unable to save step.')).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
          'All good',
        )
        expect(screen.getByRole('textbox', { name: 'Notes' })).toBeEnabled()
        expect(
          fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT'),
        ).toHaveLength(2)
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
        ).toBe(false)
      })
    })

    it('keeps a deleted step but does not let it be ticked', async () => {
      mockFetch(async () =>
        jsonResponse({
          ...run,
          steps: [
            {
              stepId: null,
              text: 'Old step',
              isDone: false,
              completedAt: null,
            },
          ],
        }),
      )

      renderAt('/runs/5')

      expect(
        await screen.findByRole('checkbox', { name: 'Old step' }),
      ).toBeDisabled()
    })

    it('shows not found when the run does not exist', async () => {
      mockFetch(async () => new Response(null, { status: 404 }))

      renderAt('/runs/99')

      expect(
        await screen.findByText(
          "That fill-out doesn't exist. Its checklist may have been deleted.",
        ),
      ).toBeInTheDocument()
    })

    it('shows not found without calling the API for an invalid id', () => {
      mockFetch(async () => jsonResponse(run))

      renderAt('/runs/abc')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Page not found' }),
      ).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('shows an error when the run cannot be loaded', async () => {
      mockFetch(async () => new Response(null, { status: 500 }))

      renderAt('/runs/5')

      expect(
        await screen.findByText('Unable to load this fill-out.'),
      ).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'loadRun',
      })
    })
  })

  describe('fill-out history', () => {
    const checklist = { id: 3, name: 'Morning', steps: [] }
    const inProgress = {
      id: 6,
      startedAt: '2026-10-07T08:00:00Z',
      completedAt: null,
    }
    const completed = {
      id: 5,
      startedAt: '2026-10-06T08:00:00Z',
      completedAt: '2026-10-06T08:30:00Z',
    }

    function local(value: string) {
      return new Date(value).toLocaleString()
    }

    it('lists each fill-out newest first, linking to it', async () => {
      const fetchMock = mockFetch(
        async () => jsonResponse(checklist),
        async () => jsonResponse([inProgress, completed]),
      )

      renderAt('/checklists/3')

      const list = await screen.findByRole('list', { name: 'Fill-outs' })
      const links = within(list).getAllByRole('link')
      expect(links).toHaveLength(2)
      expect(links[0]).toHaveAttribute('href', '/runs/6')
      expect(links[0]).toHaveTextContent(
        `Started ${local(inProgress.startedAt)}In progress`,
      )
      expect(links[1]).toHaveAttribute('href', '/runs/5')
      expect(links[1]).toHaveTextContent(
        `Started ${local(completed.startedAt)}Completed ${local(completed.completedAt)}`,
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/3\/runs$/),
      )
    })

    it('shows "No fill-outs yet." when the checklist has none', async () => {
      mockFetch(async () => jsonResponse(checklist))

      renderAt('/checklists/3')

      expect(await screen.findByText('No fill-outs yet.')).toBeInTheDocument()
    })

    it('shows an error when the fill-outs cannot be loaded', async () => {
      mockFetch(
        async () => jsonResponse(checklist),
        async () => new Response(null, { status: 500 }),
      )

      renderAt('/checklists/3')

      expect(
        await screen.findByText('Unable to load fill-outs.'),
      ).toBeInTheDocument()
      // The rest of the page still works.
      expect(screen.getByRole('button', { name: 'Fill out' })).toBeEnabled()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'loadRuns',
      })
    })

    it('resumes a fill-out in progress', async () => {
      const user = userEvent.setup()
      mockFetch(
        async (url) =>
          url.endsWith('/api/runs/6')
            ? jsonResponse({
                id: 6,
                checklistId: 3,
                checklistName: 'Morning',
                startedAt: inProgress.startedAt,
                completedAt: null,
                steps: [
                  {
                    stepId: 11,
                    text: 'Make coffee',
                    type: 'Checkbox',
                    isDone: true,
                    completedAt: '2026-10-07T08:05:00Z',
                    responseText: null,
                  },
                ],
              })
            : jsonResponse(checklist),
        async () => jsonResponse([inProgress]),
      )

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('link', { name: /Started/ }))

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).toBeChecked()
      expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
      expect(screen.queryByText(/^Done /)).not.toBeInTheDocument()
    })

    it('opens a completed fill-out read-only, with when each step was done', async () => {
      const user = userEvent.setup()
      mockFetch(
        async (url) =>
          url.endsWith('/api/runs/5')
            ? jsonResponse({
                id: 5,
                checklistId: 3,
                checklistName: 'Morning',
                startedAt: completed.startedAt,
                completedAt: completed.completedAt,
                steps: [
                  {
                    stepId: 11,
                    text: 'Make coffee',
                    type: 'Checkbox',
                    isDone: true,
                    completedAt: '2026-10-06T08:05:00Z',
                    responseText: null,
                  },
                  {
                    stepId: 12,
                    text: 'Read email',
                    type: 'Checkbox',
                    isDone: false,
                    completedAt: null,
                    responseText: null,
                  },
                ],
              })
            : jsonResponse(checklist),
        async () => jsonResponse([completed]),
      )

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('link', { name: /Started/ }))

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).toBeDisabled()
      expect(
        screen.getByRole('checkbox', { name: 'Read email' }),
      ).toBeDisabled()
      expect(
        screen.getByText(`Done ${local('2026-10-06T08:05:00Z')}`),
      ).toBeInTheDocument()
      expect(screen.getAllByText(/^Done /)).toHaveLength(1)
      expect(
        screen.getByText(`Completed ${local(completed.completedAt)}`),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Complete' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('unknown routes', () => {
    it('shows a not found page with a link back to the list', () => {
      mockFetch(async () => jsonResponse([]))

      renderAt('/no/such/page')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Page not found' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Go to checklists' }),
      ).toHaveAttribute('href', '/')
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})

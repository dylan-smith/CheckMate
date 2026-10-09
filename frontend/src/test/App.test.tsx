import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setSession } from '../auth/session'
import { createLocalRun } from '../offline/runs'
import { getLocalStore } from '../offline/store'
import type { LocalRun } from '../offline/store'
import { configureSync } from '../offline/sync'
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

// fetch rejects like this when the API can't be reached at all.
function unreachable(): Promise<Response> {
  throw new TypeError('Failed to fetch')
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

// Signed in, since the app only shows the sign-in page otherwise. auth.test.tsx covers signing in and out.
beforeEach(() => {
  setSession({ token: 'test:Tester', name: 'Tester', provider: 'test' })
  // Fill-outs are sent to the API as soon as they change, rather than a second later.
  configureSync({ debounceMs: 0 })
})

// The signed-in test user's store on this device.
function localStore() {
  return getLocalStore('test:tester')
}

afterEach(() => {
  // Signing out re-renders the app if a test left it mounted.
  act(() => setSession(null))
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
      mockFetch(unreachable, unreachable)

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
        expect.anything(),
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
      mockFetch(unreachable, unreachable)

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
        {
          id: 10,
          text: 'Make coffee',
          type: 'Checkbox' as const,
          sortOrder: 0,
          options: [],
          dependsOnStepIds: [],
        },
        {
          id: 11,
          text: 'Read email',
          type: 'Checkbox',
          sortOrder: 1,
          options: [],
          dependsOnStepIds: [],
        },
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
            {
              id: 12,
              text: 'Walk dog',
              type: 'Checkbox',
              sortOrder: 2,
              options: [],
              dependsOnStepIds: [],
            },
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
          body: JSON.stringify({
            text: 'Walk dog',
            type: 'Checkbox',
            options: [],
            dependsOnStepIds: [],
          }),
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
            options: [],
            dependsOnStepIds: [],
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
          body: JSON.stringify({
            text: 'Make tea',
            type: 'Checkbox',
            options: [],
            dependsOnStepIds: [],
          }),
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
            {
              id: 11,
              text: 'Read email',
              type: 'Checkbox',
              sortOrder: 0,
              options: [],
              dependsOnStepIds: [],
            },
            {
              id: 10,
              text: 'Make coffee',
              type: 'Checkbox',
              sortOrder: 1,
              options: [],
              dependsOnStepIds: [],
            },
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
      // The list moves the step straight away, but this is only announced once the order is saved.
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Moved step "Make coffee" to position 2 of 2.',
        )
      })
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

    const rowHeight = 50

    // Drags a step by its handle to the middle of the row at targetIndex.
    async function dragStep(
      text: string,
      fromIndex: number,
      targetIndex: number,
    ) {
      // jsdom has no layout, so each step gets a row stacked from the top. Anything else measured is
      // the dragged copy, which starts on the dragged step's row.
      const rows = screen.getAllByRole('listitem')
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        const index = rows.indexOf(this)
        return DOMRect.fromRect({
          x: 0,
          y: (index === -1 ? fromIndex : index) * rowHeight,
          width: 600,
          height: rowHeight,
        })
      })

      const handle = screen.getByTitle(`Drag to reorder step "${text}"`)
      const pointer = { isPrimary: true, button: 0, clientX: 10 }
      const fromY = fromIndex * rowHeight + rowHeight / 2
      const toY = targetIndex * rowHeight + rowHeight / 2
      fireEvent.pointerDown(handle, { ...pointer, clientY: fromY })
      // The first move passes the few pixels a drag needs to start.
      fireEvent.pointerMove(document, { ...pointer, clientY: fromY + 10 })
      fireEvent.pointerMove(document, { ...pointer, clientY: toY })
      // dnd-kit works out where the step is over in an animation frame.
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
      fireEvent.pointerUp(document, { ...pointer, clientY: toY })
    }

    it('drags a step above another and saves the new order', async () => {
      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse([
            {
              id: 11,
              text: 'Read email',
              type: 'Checkbox',
              sortOrder: 0,
              options: [],
              dependsOnStepIds: [],
            },
            {
              id: 10,
              text: 'Make coffee',
              type: 'Checkbox',
              sortOrder: 1,
              options: [],
              dependsOnStepIds: [],
            },
          ])
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')
      await screen.findByText('Read email')

      await dragStep('Read email', 1, 0)

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
          'Read email',
        )
      })
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps\/order$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ stepIds: [11, 10] }),
        }),
      )
      // The list moves the step straight away, but this is only announced once the order is saved.
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Moved step "Read email" to position 1 of 2.',
        )
      })
      expect(trackEvent).toHaveBeenCalledWith('StepsReordered')
    })

    it('does not save when a step is dropped where it already is', async () => {
      mockFetch(async () => jsonResponse(checklistWithSteps))

      renderAt('/checklists/1')
      await screen.findByText('Read email')

      await dragStep('Read email', 1, 1)

      expect(fetch).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: 'PUT' }),
      )
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
        'Make coffee',
      )
    })

    it('adds a text step with the type picker and labels it', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            {
              id: 12,
              text: 'Notes',
              type: 'Text',
              sortOrder: 2,
              options: [],
              dependsOnStepIds: [],
            },
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
          body: JSON.stringify({
            text: 'Notes',
            type: 'Text',
            options: [],
            dependsOnStepIds: [],
          }),
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
            options: [],
            dependsOnStepIds: [],
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
          body: JSON.stringify({
            text: 'Make coffee',
            type: 'Text',
            options: [],
            dependsOnStepIds: [],
          }),
        }),
      )
    })

    describe('prerequisites', () => {
      const checklistWithThreeSteps = {
        id: 1,
        name: 'Morning',
        steps: [
          ...checklistWithSteps.steps,
          {
            id: 12,
            text: 'Walk dog',
            type: 'Checkbox',
            sortOrder: 2,
            options: [],
            dependsOnStepIds: [],
          },
        ],
      }

      // The step editor and the new step form both have a prerequisite picker, so queries go through the form.
      function editor() {
        return within(screen.getByRole('form', { name: /^Edit step / }))
      }

      function newStepForm() {
        return within(screen.getByRole('form', { name: 'Add a step' }))
      }

      it('picks prerequisites for a new step', async () => {
        const user = userEvent.setup()

        mockFetch(async (_url, init) => {
          if (init?.method === 'POST') {
            return jsonResponse(
              {
                id: 12,
                text: 'Walk dog',
                type: 'Checkbox',
                sortOrder: 2,
                options: [],
                dependsOnStepIds: [10, 11],
              },
              201,
            )
          }
          return jsonResponse(checklistWithSteps)
        })

        renderAt('/checklists/1')

        await user.type(await screen.findByLabelText('New step'), 'Walk dog')
        const picker = newStepForm().getByRole('combobox', {
          name: 'Depends on',
        })
        expect(picker).toHaveTextContent('None')
        await user.click(picker)
        // Every step already on the checklist is offered.
        await user.click(screen.getByRole('option', { name: 'Read email' }))
        await user.click(screen.getByRole('option', { name: 'Make coffee' }))
        await user.keyboard('{Escape}')
        expect(picker).toHaveTextContent('Make coffee, Read email')
        await user.click(screen.getByRole('button', { name: 'Add step' }))

        await waitFor(() => {
          expect(screen.getAllByRole('listitem')[2]).toHaveTextContent(
            'Walk dogDepends on: Make coffee, Read email',
          )
        })
        expect(fetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/checklists\/1\/steps$/),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              text: 'Walk dog',
              type: 'Checkbox',
              options: [],
              dependsOnStepIds: [10, 11],
            }),
          }),
        )
        // The picker starts over for the next step, which can now also depend on the one just added.
        expect(picker).toHaveTextContent('None')
        await user.click(picker)
        expect(
          screen.getByRole('option', { name: 'Walk dog' }),
        ).toBeInTheDocument()
      })

      it("doesn't offer prerequisites for a checklist's first step", async () => {
        mockFetch(async () => jsonResponse({ id: 1, name: 'Empty', steps: [] }))

        renderAt('/checklists/1')

        await screen.findByLabelText('New step')
        expect(
          screen.queryByRole('combobox', { name: 'Depends on' }),
        ).not.toBeInTheDocument()
      })

      it('shows why the API rejected a new step without reporting it', async () => {
        const user = userEvent.setup()
        const message =
          'A step can only depend on other steps of the same checklist.'

        mockFetch(async (_url, init) => {
          if (init?.method === 'POST') {
            return jsonResponse(
              {
                title: 'Validation failed',
                errors: { DependsOnStepIds: [message] },
              },
              400,
            )
          }
          return jsonResponse(checklistWithSteps)
        })

        renderAt('/checklists/1')

        await user.type(await screen.findByLabelText('New step'), 'Walk dog')
        await user.click(
          newStepForm().getByRole('combobox', { name: 'Depends on' }),
        )
        await user.click(screen.getByRole('option', { name: 'Make coffee' }))
        await user.keyboard('{Escape}')
        await user.click(screen.getByRole('button', { name: 'Add step' }))

        expect(await screen.findByText(message)).toBeInTheDocument()
        // What was typed and picked stays, so it can be fixed and added again.
        expect(screen.getByLabelText('New step')).toHaveValue('Walk dog')
        expect(
          newStepForm().getByRole('combobox', { name: 'Depends on' }),
        ).toHaveTextContent('Make coffee')
        expect(trackException).not.toHaveBeenCalled()
      })

      it("drops a deleted step from the new step's prerequisites", async () => {
        const user = userEvent.setup()

        mockFetch(async (_url, init) => {
          if (init?.method === 'DELETE') {
            return new Response(null, { status: 204 })
          }
          return jsonResponse(checklistWithSteps)
        })

        renderAt('/checklists/1')

        const picker = await waitFor(() =>
          newStepForm().getByRole('combobox', { name: 'Depends on' }),
        )
        await user.click(picker)
        await user.click(screen.getByRole('option', { name: 'Make coffee' }))
        await user.click(screen.getByRole('option', { name: 'Read email' }))
        await user.keyboard('{Escape}')
        await user.click(
          screen.getByRole('button', { name: 'Delete step "Make coffee"' }),
        )

        await waitFor(() => {
          expect(screen.getAllByRole('listitem')).toHaveLength(1)
        })
        expect(picker).toHaveTextContent('Read email')
        expect(picker).not.toHaveTextContent('Make coffee')
      })

      it('picks prerequisites in the step editor and lists them', async () => {
        const user = userEvent.setup()

        mockFetch(async (_url, init) => {
          if (init?.method === 'PUT') {
            return jsonResponse({
              id: 12,
              text: 'Walk dog',
              type: 'Checkbox',
              sortOrder: 2,
              options: [],
              dependsOnStepIds: [10, 11],
            })
          }
          return jsonResponse(checklistWithThreeSteps)
        })

        renderAt('/checklists/1')

        await user.click(
          await screen.findByRole('button', { name: 'Edit step "Walk dog"' }),
        )
        const picker = editor().getByRole('combobox', { name: 'Depends on' })
        expect(picker).toHaveTextContent('None')
        await user.click(picker)
        // A step can't depend on itself, so it isn't offered.
        expect(
          screen.queryByRole('option', { name: 'Walk dog' }),
        ).not.toBeInTheDocument()
        await user.click(screen.getByRole('option', { name: 'Read email' }))
        await user.click(screen.getByRole('option', { name: 'Make coffee' }))
        expect(
          screen.getByRole('option', { name: 'Make coffee' }),
        ).toHaveAttribute('aria-selected', 'true')
        await user.keyboard('{Escape}')
        // The picker lists them in checklist order, not the order they were picked.
        expect(picker).toHaveTextContent('Make coffee, Read email')
        await user.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => {
          expect(screen.getAllByRole('listitem')[2]).toHaveTextContent(
            'Walk dogDepends on: Make coffee, Read email',
          )
        })
        expect(fetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/checklists\/1\/steps\/12$/),
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({
              text: 'Walk dog',
              type: 'Checkbox',
              options: [],
              dependsOnStepIds: [10, 11],
            }),
          }),
        )
      })

      it("doesn't offer prerequisites when there's only one step", async () => {
        const user = userEvent.setup()

        mockFetch(async () =>
          jsonResponse({
            ...checklistWithSteps,
            steps: [checklistWithSteps.steps[0]],
          }),
        )

        renderAt('/checklists/1')

        await user.click(
          await screen.findByRole('button', {
            name: 'Edit step "Make coffee"',
          }),
        )
        expect(
          editor().queryByRole('combobox', { name: 'Depends on' }),
        ).not.toBeInTheDocument()
      })

      it('shows why the API rejected the prerequisites without reporting it', async () => {
        const user = userEvent.setup()
        const message =
          'Steps can\'t depend on each other in a loop: "Make coffee" depends on "Read email" depends on "Make coffee".'

        mockFetch(async (_url, init) => {
          if (init?.method === 'PUT') {
            return jsonResponse(
              {
                title: 'Validation failed',
                errors: { DependsOnStepIds: [message] },
              },
              400,
            )
          }
          return jsonResponse({
            ...checklistWithSteps,
            steps: [
              checklistWithSteps.steps[0],
              { ...checklistWithSteps.steps[1], dependsOnStepIds: [10] },
            ],
          })
        })

        renderAt('/checklists/1')

        await user.click(
          await screen.findByRole('button', {
            name: 'Edit step "Make coffee"',
          }),
        )
        await user.click(editor().getByRole('combobox', { name: 'Depends on' }))
        await user.click(screen.getByRole('option', { name: 'Read email' }))
        await user.keyboard('{Escape}')
        await user.click(screen.getByRole('button', { name: 'Save' }))

        expect(await screen.findByText(message)).toBeInTheDocument()
        // The editor stays open so the prerequisites can be changed.
        expect(
          editor().getByRole('combobox', { name: 'Depends on' }),
        ).toHaveTextContent('Read email')
        expect(trackException).not.toHaveBeenCalled()
      })

      it('drops a deleted step from the prerequisites it was in', async () => {
        const user = userEvent.setup()

        mockFetch(async (_url, init) => {
          if (init?.method === 'DELETE') {
            return new Response(null, { status: 204 })
          }
          return jsonResponse({
            ...checklistWithThreeSteps,
            steps: [
              checklistWithThreeSteps.steps[0],
              checklistWithThreeSteps.steps[1],
              {
                ...checklistWithThreeSteps.steps[2],
                options: [],
                dependsOnStepIds: [10, 11],
              },
            ],
          })
        })

        renderAt('/checklists/1')

        const walkDog = (await screen.findAllByRole('listitem'))[2]
        expect(walkDog).toHaveTextContent('Depends on: Make coffee, Read email')
        await user.click(
          screen.getByRole('button', { name: 'Delete step "Make coffee"' }),
        )

        await waitFor(() => {
          expect(screen.getAllByRole('listitem')).toHaveLength(2)
        })
        expect(screen.getAllByRole('listitem')[1]).toHaveTextContent(
          'Walk dogDepends on: Read email',
        )
        expect(screen.getAllByRole('listitem')[1]).not.toHaveTextContent(
          'Make coffee',
        )
        await user.click(
          screen.getByRole('button', { name: 'Edit step "Walk dog"' }),
        )
        expect(
          editor().getByRole('combobox', { name: 'Depends on' }),
        ).toHaveTextContent('Read email')
      })

      it('drops a step deleted while the editor that picked it is open', async () => {
        const user = userEvent.setup()

        mockFetch(async (_url, init) => {
          if (init?.method === 'DELETE') {
            return new Response(null, { status: 204 })
          }
          if (init?.method === 'PUT') {
            return jsonResponse({
              id: 11,
              text: 'Read email',
              type: 'Checkbox',
              sortOrder: 1,
              options: [],
              dependsOnStepIds: [],
            })
          }
          return jsonResponse({
            ...checklistWithSteps,
            steps: [
              checklistWithSteps.steps[0],
              { ...checklistWithSteps.steps[1], dependsOnStepIds: [10] },
            ],
          })
        })

        renderAt('/checklists/1')

        await user.click(
          await screen.findByRole('button', { name: 'Edit step "Read email"' }),
        )
        await user.click(
          screen.getByRole('button', { name: 'Delete step "Make coffee"' }),
        )
        await waitFor(() => {
          expect(screen.getAllByRole('listitem')).toHaveLength(1)
        })
        // With only one step left the picker is hidden, so the deleted step can't be left picked in it.
        await user.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => {
          expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/api\/checklists\/1\/steps\/11$/),
            expect.objectContaining({
              method: 'PUT',
              body: JSON.stringify({
                text: 'Read email',
                type: 'Checkbox',
                options: [],
                dependsOnStepIds: [],
              }),
            }),
          )
        })
      })
    })

    it('adds a multiple choice step with its options in order', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            {
              id: 12,
              text: 'Weather',
              type: 'Choice',
              sortOrder: 2,
              options: [
                { id: 1, text: 'Rainy' },
                { id: 2, text: 'Sunny' },
                { id: 3, text: 'Snowy' },
              ],
              dependsOnStepIds: [],
            },
            201,
          )
        }
        return jsonResponse(checklistWithSteps)
      })

      renderAt('/checklists/1')

      await user.type(await screen.findByLabelText('New step'), 'Weather')
      await user.click(screen.getByRole('combobox', { name: 'Type' }))
      await user.click(screen.getByRole('option', { name: 'Multiple choice' }))
      // A choice step starts with two blank options, which can't be removed below two.
      expect(
        screen.getByRole('button', { name: 'Remove option 1' }),
      ).toBeDisabled()
      await user.type(screen.getByLabelText('Option 1'), ' Sunny ')
      await user.type(screen.getByLabelText('Option 2'), 'Rainy')
      await user.click(screen.getByRole('button', { name: 'Add option' }))
      // The new option's field takes focus.
      await user.keyboard('Snowy')
      await user.click(screen.getByRole('button', { name: 'Move option 2 up' }))
      expect(screen.getByLabelText('Option 1')).toHaveValue('Rainy')
      await user.click(screen.getByRole('button', { name: 'Add step' }))

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(3)
      })
      expect(screen.getAllByRole('listitem')[2]).toHaveTextContent(
        'WeatherMultiple choice: Rainy, Sunny, Snowy',
      )
      // The options go away with the type, ready for the next step.
      expect(screen.queryByLabelText('Option 1')).not.toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            text: 'Weather',
            type: 'Choice',
            options: [{ text: 'Rainy' }, { text: 'Sunny' }, { text: 'Snowy' }],
            dependsOnStepIds: [],
          }),
        }),
      )
    })

    it.each([
      ['an option is blank', 'Sunny', ' ', 'Option text is required.'],
      ['two options match', 'Sunny', 'sunny', 'Each option must be different.'],
    ])(
      "doesn't add a multiple choice step when %s",
      async (_case, first, second, message) => {
        const user = userEvent.setup()
        mockFetch(async () => jsonResponse(checklistWithSteps))

        renderAt('/checklists/1')

        await user.type(await screen.findByLabelText('New step'), 'Weather')
        await user.click(screen.getByRole('combobox', { name: 'Type' }))
        await user.click(
          screen.getByRole('option', { name: 'Multiple choice' }),
        )
        await user.type(screen.getByLabelText('Option 1'), first)
        await user.type(screen.getByLabelText('Option 2'), second)
        await user.click(screen.getByRole('button', { name: 'Add step' }))

        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(fetch).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ method: 'POST' }),
        )
      },
    )

    it("edits a multiple choice step's options, keeping their ids", async () => {
      const user = userEvent.setup()
      const choiceStep = {
        id: 10,
        text: 'Weather',
        type: 'Choice',
        sortOrder: 0,
        options: [
          { id: 1, text: 'Sunny' },
          { id: 2, text: 'Rainy' },
          { id: 3, text: 'Snowy' },
        ],
        dependsOnStepIds: [],
      }

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({
            ...choiceStep,
            options: [
              { id: 1, text: 'Bright' },
              { id: 3, text: 'Snowy' },
            ],
          })
        }
        return jsonResponse({ id: 1, name: 'Morning', steps: [choiceStep] })
      })

      renderAt('/checklists/1')

      await user.click(
        await screen.findByRole('button', { name: 'Edit step "Weather"' }),
      )
      const first = screen.getByLabelText('Option 1')
      await user.clear(first)
      await user.type(first, 'Bright')
      await user.click(screen.getByRole('button', { name: 'Remove option 2' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
          'WeatherMultiple choice: Bright, Snowy',
        )
      })
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1\/steps\/10$/),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            text: 'Weather',
            type: 'Choice',
            options: [
              { id: 1, text: 'Bright' },
              { id: 3, text: 'Snowy' },
            ],
            dependsOnStepIds: [],
          }),
        }),
      )
    })

    it('asks to save again without reporting it when a removed option was picked while saving', async () => {
      const user = userEvent.setup()
      const message =
        'A fill-out picked one of the removed options while this was saving. Try saving again.'
      const choiceStep = {
        id: 10,
        text: 'Weather',
        type: 'Choice',
        sortOrder: 0,
        options: [
          { id: 1, text: 'Sunny' },
          { id: 2, text: 'Rainy' },
          { id: 3, text: 'Snowy' },
        ],
        dependsOnStepIds: [],
      }
      mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({ message }, 409)
          : jsonResponse({ id: 1, name: 'Morning', steps: [choiceStep] }),
      )

      renderAt('/checklists/1')
      await user.click(
        await screen.findByRole('button', { name: 'Edit step "Weather"' }),
      )
      await user.click(screen.getByRole('button', { name: 'Remove option 3' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText(message)).toBeInTheDocument()
      // Still editing, so saving again is one click.
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(trackException).not.toHaveBeenCalled()
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
    const runKey = 'c0ffee00-0000-4000-8000-000000000005'
    const runPath = `/runs/${runKey}`
    const runApiUrl = `/api/runs/${runKey}`
    // Fill-outs of checklist 3 are sent to the API under the key the device gave them.
    const syncUrlPattern = /\/api\/checklists\/3\/runs\/[0-9a-f-]{36}$/
    const completedElsewhereMessage =
      'This fill-out was completed on another device, so it shows what was saved there.'

    function checkboxStep(
      stepId: number | null,
      text: string,
      { isDone = false, dependsOnStepIds = [] as number[] } = {},
    ) {
      return {
        stepId,
        text,
        type: 'Checkbox',
        isDone,
        completedAt: isDone ? '2026-10-06T08:05:00Z' : null,
        responseText: null,
        responseNumber: null,
        options: [],
        selectedOptionId: null,
        selectedOptionText: null,
        dependsOnStepIds,
        isLocked: false,
      }
    }

    const run = {
      id: 5,
      clientKey: runKey,
      checklistId: 3,
      checklistName: 'Morning',
      startedAt: '2026-10-06T08:00:00Z',
      completedAt: null,
      steps: [
        checkboxStep(11, 'Make coffee'),
        checkboxStep(12, 'Read email', { isDone: true }),
      ],
    }
    // Every step done, so the fill-out can be completed.
    const doneSteps = [
      checkboxStep(11, 'Make coffee', { isDone: true }),
      checkboxStep(12, 'Read email', { isDone: true }),
    ]
    const completable = { ...run, steps: doneSteps }

    const morningChecklist = {
      id: 3,
      name: 'Morning',
      steps: [
        {
          id: 11,
          text: 'Make coffee',
          type: 'Checkbox' as const,
          sortOrder: 0,
          options: [],
          dependsOnStepIds: [],
        },
      ],
    }

    type SyncStep = {
      stepId: number
      isDone: boolean
      completedAt: string | null
      responseText: string | null
      responseNumber: number | null
      selectedOptionId: number | null
      selectedOptionText: string | null
    }

    type SyncBody = {
      startedAt: string
      completedAt: string | null
      steps: SyncStep[]
    }

    // The fill-out as each sync sent it, oldest first.
    function syncs(fetchMock: ReturnType<typeof mockFetch>): SyncBody[] {
      return fetchMock.mock.calls
        .filter(
          ([url, init]) =>
            init?.method === 'PUT' &&
            syncUrlPattern.test(
              typeof url === 'string'
                ? url
                : url instanceof URL
                  ? url.href
                  : url.url,
            ),
        )
        .map(([, init]) => JSON.parse(init?.body as string) as SyncBody)
    }

    function lastSyncedStep(
      fetchMock: ReturnType<typeof mockFetch>,
      stepId: number,
    ) {
      return syncs(fetchMock)
        .at(-1)
        ?.steps.find((step) => step.stepId === stepId)
    }

    // Answers the run page's requests: the run by its key, its syncs (with the run as sent, unless onSync says
    // otherwise), and the checklists list for the page completing goes back to.
    function mockRunPage(
      loaded: object = run,
      onSync?: (body: SyncBody) => Response | Promise<Response>,
    ) {
      return mockFetch(async (url, init) => {
        if (init?.method === 'PUT' && syncUrlPattern.test(url)) {
          const body = JSON.parse(init.body as string) as SyncBody
          return onSync ? onSync(body) : jsonResponse({ ...loaded, ...body })
        }
        if (url.endsWith(runApiUrl)) {
          return jsonResponse(loaded)
        }
        return jsonResponse([])
      })
    }

    it('starts a fill-out from the checklist page and opens it', async () => {
      const user = userEvent.setup()
      const fetchMock = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({ ...run, id: 7 })
          : jsonResponse(morningChecklist),
      )

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('button', { name: 'Fill out' }))

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).not.toBeChecked()
      expect(trackEvent).toHaveBeenCalledWith('RunStarted')
      // The fill-out lives on the device, and is sent to the API under the key the device gave it.
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(syncUrlPattern),
          expect.objectContaining({ method: 'PUT' }),
        )
      })
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(false)
    })

    it('starts a fill-out straight from the checklists page', async () => {
      const user = userEvent.setup()
      const fetchMock = mockFetch(async (url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({ ...run, id: 7 })
        }
        return url.endsWith('/api/checklists/3')
          ? jsonResponse(morningChecklist)
          : jsonResponse([
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
      expect(trackEvent).toHaveBeenCalledWith('RunStarted')
      await waitFor(() => {
        expect(syncs(fetchMock)).toHaveLength(1)
      })
    })

    it('starts a fill-out from the copy on the device when the API cannot be reached', async () => {
      const user = userEvent.setup()
      await localStore().putChecklistList([{ id: 3, name: 'Morning' }])
      await localStore().putChecklist(morningChecklist)
      mockFetch(unreachable)

      renderAt('/')
      expect(
        await screen.findByText(
          "CheckMate couldn't be reached, so this is the copy saved on this device.",
        ),
      ).toBeInTheDocument()
      await user.click(
        await screen.findByRole('button', { name: 'Fill out "Morning"' }),
      )
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      expect(await screen.findByText('1 of 1 done')).toBeInTheDocument()
      expect(
        await screen.findByText('1 to sync, will retry'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows an error on the checklists page when a fill-out cannot be started', async () => {
      const user = userEvent.setup()
      mockFetch(async (url) =>
        url.endsWith('/api/checklists/3')
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

    it('shows an error when a fill-out cannot be started', async () => {
      const user = userEvent.setup()
      let loads = 0
      mockFetch(async () => {
        loads += 1
        // The page loads the checklist once, and loads it again to start the fill-out from its latest steps.
        return loads === 1
          ? jsonResponse(morningChecklist)
          : new Response(null, { status: 500 })
      })

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('button', { name: 'Fill out' }))

      expect(
        await screen.findByText('Unable to start filling out the checklist.'),
      ).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'startRun',
      })
    })

    it('shows the run with each step and a link back to the checklists', async () => {
      mockRunPage()

      renderAt(runPath)

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Morning' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Read email' })).toBeChecked()
      expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: /Back to checklists/ }),
      ).toHaveAttribute('href', '/')
    })

    it('keeps a tick on the device straight away and sends the fill-out', async () => {
      const user = userEvent.setup()
      const fetchMock = mockRunPage()

      renderAt(runPath)
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      expect(
        screen.getByRole('checkbox', { name: 'Make coffee' }),
      ).toBeChecked()
      expect(await screen.findByText('2 of 2 done')).toBeInTheDocument()
      await waitFor(() => {
        expect(lastSyncedStep(fetchMock, 11)).toMatchObject({
          isDone: true,
          completedAt: expect.any(String) as string,
        })
      })
      expect(await localStore().getRun(runKey)).toMatchObject({
        serverId: 5,
        steps: [
          { stepId: 11, isDone: true },
          { stepId: 12, isDone: true },
        ],
      })
    })

    it('keeps a change on the device and tries again later when the API cannot be reached', async () => {
      const user = userEvent.setup()
      const fetchMock = mockRunPage(run, unreachable)

      renderAt(runPath)
      await user.click(
        await screen.findByRole('checkbox', { name: 'Read email' }),
      )

      expect(
        await screen.findByText('1 to sync, will retry'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Read email' }),
      ).not.toBeChecked()
      expect(screen.getByText('0 of 2 done')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(syncs(fetchMock)).toHaveLength(1)
      expect(trackException).not.toHaveBeenCalled()
    })

    it('sends the tick with the completion when completing straight after it', async () => {
      const user = userEvent.setup()
      const fetchMock = mockRunPage()

      renderAt(runPath)
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )
      await user.click(screen.getByRole('button', { name: 'Complete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Completed "Morning".',
      )
      const last = syncs(fetchMock).at(-1)
      expect(last?.completedAt).toEqual(expect.any(String))
      expect(last?.steps.find((step) => step.stepId === 11)?.isDone).toBe(true)
    })

    it('completes the run and goes back to the checklists page', async () => {
      const user = userEvent.setup()
      const fetchMock = mockRunPage(completable)

      renderAt(runPath)
      await user.click(await screen.findByRole('button', { name: 'Complete' }))

      expect(await screen.findByText('No checklists yet.')).toBeInTheDocument()
      expect(syncs(fetchMock).at(-1)?.completedAt).toEqual(expect.any(String))
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(false)
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

    it('completes the run on the device when the API cannot be reached, and sends it later', async () => {
      const user = userEvent.setup()
      mockRunPage(completable, unreachable)

      renderAt(runPath)
      await user.click(await screen.findByRole('button', { name: 'Complete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Completed "Morning". It's saved on this device and will sync when you're online.`,
      )
      expect(trackEvent).toHaveBeenCalledWith('RunCompleted')
      expect(
        await screen.findByText('1 to sync, will retry'),
      ).toBeInTheDocument()
      expect(await localStore().getRun(runKey)).toMatchObject({
        completedAt: expect.any(String) as string,
      })
    })

    it('does not complete the run while a step is not done', async () => {
      const user = userEvent.setup()
      const fetchMock = mockRunPage()

      renderAt(runPath)
      await user.click(await screen.findByRole('button', { name: 'Complete' }))

      expect(
        await screen.findByText(
          'Every step must be done before the run can be completed.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
      expect(syncs(fetchMock)).toHaveLength(0)
    })

    it('shows the run as complete when it was completed elsewhere', async () => {
      const user = userEvent.setup()
      const completed = { ...run, completedAt: '2026-10-06T08:30:00Z' }
      let loads = 0
      mockFetch(async (url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse(
            { message: "This run is complete and can't be changed." },
            409,
          )
        }
        if (url.endsWith(runApiUrl)) {
          loads += 1
          return jsonResponse(loads === 1 ? run : completed)
        }
        return jsonResponse([])
      })

      renderAt(runPath)
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      expect(
        await screen.findByText(completedElsewhereMessage),
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
      expect(
        screen.queryByRole('button', { name: 'Complete' }),
      ).not.toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it('opens a link from before fill-outs had keys by the key', async () => {
      mockFetch(async (url) =>
        url.endsWith('/api/runs/5') || url.endsWith(runApiUrl)
          ? jsonResponse(run)
          : jsonResponse([]),
      )

      renderAt('/runs/5')

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/runs\/5$/),
        expect.anything(),
      )
    })

    it('resumes a fill-out saved on the device without the API', async () => {
      const user = userEvent.setup()
      await localStore().putRun(
        createLocalRun(morningChecklist, runKey, '2026-10-06T08:00:00Z'),
      )
      mockFetch(unreachable)

      renderAt(runPath)
      await user.click(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      )

      expect(await screen.findByText('1 of 1 done')).toBeInTheDocument()
      expect(
        await screen.findByText('1 to sync, will retry'),
      ).toBeInTheDocument()
    })

    it('says when the fill-out is not on the device and the API cannot be reached', async () => {
      const user = userEvent.setup()
      let reachable = false
      mockFetch(async (url) => {
        if (!reachable) {
          throw new TypeError('Failed to fetch')
        }
        return url.endsWith(runApiUrl) ? jsonResponse(run) : jsonResponse([])
      })

      renderAt(runPath)

      expect(
        await screen.findByText(
          "This fill-out isn't saved on this device. Connect to the internet to load it.",
        ),
      ).toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()

      reachable = true
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(
        await screen.findByRole('checkbox', { name: 'Make coffee' }),
      ).toBeInTheDocument()
    })

    describe('prerequisites', () => {
      // Pack depends on Wash, and Leave on both.
      const chainRun = {
        ...run,
        steps: [
          checkboxStep(11, 'Wash'),
          checkboxStep(12, 'Pack', { dependsOnStepIds: [11] }),
          checkboxStep(13, 'Leave', { dependsOnStepIds: [11, 12] }),
        ],
      }

      it('shows only the steps that can be done, and the rest as they unlock', async () => {
        const user = userEvent.setup()
        mockRunPage(chainRun)

        renderAt(runPath)

        const steps = await screen.findByRole('list', { name: 'Steps' })
        expect(within(steps).getAllByRole('checkbox')).toEqual([
          within(steps).getByRole('checkbox', { name: 'Wash' }),
        ])
        expect(
          screen.getByText(
            '2 more steps show up once the steps they depend on are done.',
          ),
        ).toBeInTheDocument()
        expect(screen.getByText('0 of 3 done')).toBeInTheDocument()

        await user.click(screen.getByRole('checkbox', { name: 'Wash' }))

        // A done step stays where it is, and the step it unlocks shows up after it.
        expect(
          await screen.findByRole('checkbox', { name: 'Pack' }),
        ).not.toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'Wash' })).toBeChecked()
        expect(within(steps).getAllByRole('checkbox')).toEqual([
          screen.getByRole('checkbox', { name: 'Wash' }),
          screen.getByRole('checkbox', { name: 'Pack' }),
        ])
        expect(
          screen.queryByRole('checkbox', { name: 'Leave' }),
        ).not.toBeInTheDocument()
        expect(
          screen.getByText(
            '1 more step shows up once the steps it depends on are done.',
          ),
        ).toBeInTheDocument()

        await user.click(screen.getByRole('checkbox', { name: 'Pack' }))
        await user.click(await screen.findByRole('checkbox', { name: 'Leave' }))

        expect(await screen.findByText('3 of 3 done')).toBeInTheDocument()
        expect(screen.queryByText(/show up once/)).not.toBeInTheDocument()
      })

      it('does not let a step be un-done while a done step depends on it', async () => {
        const user = userEvent.setup()
        mockRunPage({
          ...chainRun,
          steps: [
            checkboxStep(11, 'Wash', { isDone: true }),
            checkboxStep(12, 'Pack', { isDone: true, dependsOnStepIds: [11] }),
            checkboxStep(13, 'Leave', { dependsOnStepIds: [11, 12] }),
          ],
        })

        renderAt(runPath)

        expect(
          await screen.findByRole('checkbox', { name: 'Wash' }),
        ).toBeDisabled()

        await user.click(screen.getByRole('checkbox', { name: 'Pack' }))

        // Unticking Pack hides Leave again and lets Wash be unticked.
        expect(screen.getByRole('checkbox', { name: 'Pack' })).not.toBeChecked()
        expect(
          screen.queryByRole('checkbox', { name: 'Leave' }),
        ).not.toBeInTheDocument()
        await waitFor(() => {
          expect(screen.getByRole('checkbox', { name: 'Wash' })).toBeEnabled()
        })
        expect(screen.queryByText(/Can't be un-done/)).not.toBeInTheDocument()
      })

      it('shows why the API would not take the fill-out, until it changes', async () => {
        const user = userEvent.setup()
        const message =
          "This step can't be filled in until the steps it depends on are done."
        const fetchMock = mockRunPage(
          {
            ...chainRun,
            steps: [
              checkboxStep(11, 'Wash', { isDone: true }),
              ...chainRun.steps.slice(1),
            ],
          },
          async () => jsonResponse({ errors: { 'Steps[1]': [message] } }, 400),
        )

        renderAt(runPath)
        await user.click(await screen.findByRole('checkbox', { name: 'Pack' }))

        expect(
          await screen.findByText(`Not synced yet: ${message}`),
        ).toBeInTheDocument()
        // The tick is kept on the device, and sent again only once something changes.
        expect(screen.getByRole('checkbox', { name: 'Pack' })).toBeChecked()
        expect(syncs(fetchMock)).toHaveLength(1)
        expect(trackException).not.toHaveBeenCalled()
      })

      it('shows why completing was rejected and keeps the run open', async () => {
        const user = userEvent.setup()
        const message =
          'Every step must be done before the run can be completed.'
        mockRunPage(completable, async (body) =>
          body.completedAt === null
            ? jsonResponse({ ...completable, ...body })
            : jsonResponse({ errors: { CompletedAt: [message] } }, 400),
        )

        renderAt(runPath)
        await user.click(
          await screen.findByRole('button', { name: 'Complete' }),
        )

        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(
          await screen.findByRole('button', { name: 'Complete' }),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('checkbox', { name: 'Make coffee' }),
        ).toBeEnabled()
        expect(await localStore().getRun(runKey)).toMatchObject({
          completedAt: null,
        })
        expect(trackException).not.toHaveBeenCalled()
      })
    })

    describe('text steps', () => {
      const notesStep = {
        ...checkboxStep(13, 'Notes'),
        type: 'Text',
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
        const fetchMock = mockRunPage(runWithText)

        renderAt(runPath)
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
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 13)).toMatchObject({
            responseText: 'All good',
            isDone: true,
          })
        })
      })

      it('saves the text when Enter is pressed, and not again if unchanged', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage(runWithText)

        renderAt(runPath)
        const field = await screen.findByRole('textbox', { name: 'Notes' })
        await user.type(field, 'All good{Enter}')

        expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
        // It's done now, and stays where it is with focus.
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveFocus()
        await user.tab()
        await waitFor(() => {
          expect(syncs(fetchMock)).toHaveLength(1)
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })

      it('does not save when the field is left unchanged', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage(runWithText)

        renderAt(runPath)
        await user.click(await screen.findByRole('textbox', { name: 'Notes' }))
        await user.tab()

        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it('keeps the typed text on the device when the API cannot be reached', async () => {
        const user = userEvent.setup()
        mockRunPage(runWithText, unreachable)

        renderAt(runPath)
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        await user.tab()

        expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
          'All good',
        )
        expect(
          await screen.findByText('1 to sync, will retry'),
        ).toBeInTheDocument()
      })

      it('shows the saved text read-only once the run is complete', async () => {
        mockRunPage({
          ...run,
          completedAt: '2026-10-06T08:30:00Z',
          steps: [savedNotes],
        })

        renderAt(runPath)

        const field = await screen.findByRole('textbox', { name: 'Notes' })
        expect(field).toHaveValue('All good')
        expect(field).toBeDisabled()
      })

      it('saves the text first when Complete is clicked straight from the field', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage({
          ...run,
          steps: [...doneSteps, notesStep],
        })

        renderAt(runPath)
        await user.type(
          await screen.findByRole('textbox', { name: 'Notes' }),
          'All good',
        )
        // Leaving the field starts its save, which is still under way when the click lands.
        await user.click(screen.getByRole('button', { name: 'Complete' }))

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Completed "Morning".',
        )
        const last = syncs(fetchMock).at(-1)
        expect(last?.completedAt).toEqual(expect.any(String))
        expect(last?.steps.find((step) => step.stepId === 13)).toMatchObject({
          responseText: 'All good',
          isDone: true,
        })
      })
    })

    describe('number steps', () => {
      const temperatureStep = {
        ...checkboxStep(14, 'Fridge temperature'),
        type: 'Number',
      }
      const runWithNumber = { ...run, steps: [...run.steps, temperatureStep] }

      it.each([
        ['-3.5', -3.5],
        ['  42 ', 42],
        ['0.000001', 0.000001],
        ['+.25', 0.25],
      ])('saves %j as a number', async (typed, number) => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage(runWithNumber)

        renderAt(runPath)
        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        expect(field).toHaveAttribute('inputmode', 'decimal')
        await user.type(field, typed)
        await user.tab()

        expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
        // Being done, it's shown again in the completed steps.
        expect(
          screen.getByRole('textbox', { name: 'Fridge temperature' }),
        ).toHaveValue(String(number))
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 14)).toMatchObject({
            responseNumber: number,
            isDone: true,
          })
        })
      })

      it.each([
        ['abc', 'Enter a number, like 12 or -3.5.'],
        ['1.2.3', 'Enter a number, like 12 or -3.5.'],
        ['12abc', 'Enter a number, like 12 or -3.5.'],
        ['-', 'Enter a number, like 12 or -3.5.'],
        [
          '1.0000001',
          'Use at most 9 digits before the decimal point and 6 after it.',
        ],
        [
          '1000000000',
          'Use at most 9 digits before the decimal point and 6 after it.',
        ],
      ])('rejects %j without saving it', async (typed, message) => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage(runWithNumber)

        renderAt(runPath)
        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        await user.type(field, typed)
        await user.tab()

        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(field).toHaveAttribute('aria-invalid', 'true')
        expect(field).toHaveValue(typed)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it.each(['-999999999.999999', '123456789.123456', '999999999.000001'])(
        'sends and shows every digit of %s, the most allowed',
        async (typed) => {
          const user = userEvent.setup()
          const bodies: string[] = []
          mockRunPage(runWithNumber, async (body) => {
            bodies.push(JSON.stringify(body))
            return jsonResponse({ ...runWithNumber, ...body })
          })

          renderAt(runPath)
          const field = await screen.findByRole('textbox', {
            name: 'Fridge temperature',
          })
          await user.type(field, typed)
          await user.tab()

          expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
          // Compared as text, so a value rounded on the way through a JavaScript number would fail.
          await waitFor(() => {
            expect(bodies.at(-1)).toContain(`"responseNumber":${typed}`)
          })
          expect(field).toHaveValue(typed)
        },
      )

      it('clears the error and saves once the number is fixed', async () => {
        const user = userEvent.setup()
        mockRunPage(runWithNumber)

        renderAt(runPath)
        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        await user.type(field, '4,5{Enter}')
        expect(
          await screen.findByText('Enter a number, like 12 or -3.5.'),
        ).toBeInTheDocument()

        await user.clear(field)
        await user.type(field, '4.5{Enter}')

        expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
        expect(
          screen.queryByText('Enter a number, like 12 or -3.5.'),
        ).not.toBeInTheDocument()
        expect(field).not.toHaveAttribute('aria-invalid', 'true')
      })

      it('saves an emptied field as no number', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage({
          ...run,
          steps: [
            ...run.steps,
            { ...temperatureStep, isDone: true, responseNumber: 4 },
          ],
        })

        renderAt(runPath)
        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        expect(field).toHaveValue('4')
        await user.clear(field)
        await user.tab()

        expect(await screen.findByText('1 of 3 done')).toBeInTheDocument()
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 14)).toMatchObject({
            responseNumber: null,
            isDone: false,
            completedAt: null,
          })
        })
      })

      it('does not save a number that is written differently but the same', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage({
          ...run,
          steps: [{ ...temperatureStep, isDone: true, responseNumber: 4.5 }],
        })

        renderAt(runPath)
        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        await user.clear(field)
        await user.type(field, '4.50')
        await user.tab()

        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it('does not complete while a number is invalid', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage(runWithNumber)

        renderAt(runPath)
        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        await user.type(field, 'cold')
        await user.click(screen.getByRole('button', { name: 'Complete' }))

        expect(
          await screen.findByText('Enter a number, like 12 or -3.5.'),
        ).toBeInTheDocument()
        await waitFor(() => {
          expect(field).toBeEnabled()
        })
        expect(field).toHaveValue('cold')
        expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it('saves a typed number before completing', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage({
          ...run,
          steps: [...doneSteps, temperatureStep],
        })

        renderAt(runPath)
        await user.type(
          await screen.findByRole('textbox', { name: 'Fridge temperature' }),
          '3.5',
        )
        await user.click(screen.getByRole('button', { name: 'Complete' }))

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Completed "Morning".',
        )
        const last = syncs(fetchMock).at(-1)
        expect(last?.completedAt).toEqual(expect.any(String))
        expect(last?.steps.find((step) => step.stepId === 14)).toMatchObject({
          responseNumber: 3.5,
          isDone: true,
        })
      })

      it('shows the saved number read-only once the run is complete', async () => {
        mockRunPage({
          ...run,
          completedAt: '2026-10-06T08:30:00Z',
          steps: [{ ...temperatureStep, isDone: true, responseNumber: -2.25 }],
        })

        renderAt(runPath)

        const field = await screen.findByRole('textbox', {
          name: 'Fridge temperature',
        })
        expect(field).toHaveValue('-2.25')
        expect(field).toBeDisabled()
      })
    })

    describe('multiple choice steps', () => {
      const weather = {
        ...checkboxStep(13, 'Weather'),
        type: 'Choice',
        options: [
          { id: 1, text: 'Sunny' },
          { id: 2, text: 'Rainy' },
        ],
      }
      const choiceRun = { ...run, steps: [weather] }
      const picked = {
        ...weather,
        isDone: true,
        completedAt: '2026-10-06T08:05:00Z',
        selectedOptionId: 2,
        selectedOptionText: 'Rainy',
      }

      it('saves a picked option straight away and can clear it', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage(choiceRun)

        renderAt(runPath)
        const group = await screen.findByRole('group', { name: 'Weather' })
        expect(group).toBeInTheDocument()
        await user.click(screen.getByRole('radio', { name: 'Rainy' }))

        expect(screen.getByRole('radio', { name: 'Rainy' })).toBeChecked()
        expect(await screen.findByText('1 of 1 done')).toBeInTheDocument()
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 13)).toMatchObject({
            selectedOptionId: 2,
            selectedOptionText: 'Rainy',
            isDone: true,
          })
        })

        await user.click(
          await screen.findByRole('button', { name: 'Clear "Weather"' }),
        )

        expect(await screen.findByText('0 of 1 done')).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: 'Rainy' })).not.toBeChecked()
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 13)).toMatchObject({
            selectedOptionId: null,
            selectedOptionText: null,
            isDone: false,
          })
        })
      })

      it('shows a dropdown when there are many options', async () => {
        const user = userEvent.setup()
        const options = ['A', 'B', 'C', 'D', 'E', 'F'].map((text, index) => ({
          id: index + 1,
          text,
        }))
        const fetchMock = mockRunPage({
          ...run,
          steps: [{ ...weather, options }],
        })

        renderAt(runPath)
        await user.click(
          await screen.findByRole('combobox', { name: 'Weather' }),
        )
        await user.click(screen.getByRole('option', { name: 'F' }))

        expect(screen.queryByRole('radio')).not.toBeInTheDocument()
        expect(await screen.findByText('1 of 1 done')).toBeInTheDocument()
        expect(
          screen.getByRole('combobox', { name: 'Weather' }),
        ).toHaveTextContent('F')
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 13)).toMatchObject({
            selectedOptionId: 6,
            selectedOptionText: 'F',
          })
        })
      })

      it('says when the picked option has since been removed, and can clear it', async () => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage({
          ...run,
          steps: [{ ...picked, selectedOptionId: null }],
        })

        renderAt(runPath)

        expect(
          await screen.findByText(
            `"Rainy" was picked, but it's no longer an option.`,
          ),
        ).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: 'Rainy' })).not.toBeChecked()
        expect(screen.getByText('1 of 1 done')).toBeInTheDocument()

        await user.click(
          screen.getByRole('button', { name: 'Clear "Weather"' }),
        )

        expect(await screen.findByText('0 of 1 done')).toBeInTheDocument()
        expect(
          screen.queryByText(
            `"Rainy" was picked, but it's no longer an option.`,
          ),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Clear "Weather"' }),
        ).not.toBeInTheDocument()
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 13)).toMatchObject({
            selectedOptionId: null,
            selectedOptionText: null,
          })
        })
      })

      it.each([
        ['no options are left', []],
        [
          'the options show as a dropdown',
          ['A', 'B', 'C', 'D', 'E', 'F'].map((text, index) => ({
            id: index + 1,
            text,
          })),
        ],
      ])('can clear a removed pick when %s', async (_case, options) => {
        const user = userEvent.setup()
        const fetchMock = mockRunPage({
          ...run,
          steps: [{ ...picked, options, selectedOptionId: null }],
        })

        renderAt(runPath)

        expect(
          await screen.findByText(
            `"Rainy" was picked, but it's no longer an option.`,
          ),
        ).toBeInTheDocument()
        await user.click(
          screen.getByRole('button', { name: 'Clear "Weather"' }),
        )

        expect(await screen.findByText('0 of 1 done')).toBeInTheDocument()
        await waitFor(() => {
          expect(lastSyncedStep(fetchMock, 13)).toMatchObject({
            selectedOptionId: null,
            isDone: false,
          })
        })
      })

      it('shows the option picked when the run was filled out once complete', async () => {
        mockRunPage({
          ...run,
          completedAt: '2026-10-06T08:30:00Z',
          // The option was renamed since, which doesn't change the run.
          steps: [
            {
              ...picked,
              options: [
                { id: 1, text: 'Sunny' },
                { id: 2, text: 'Raining' },
              ],
            },
          ],
        })

        renderAt(runPath)

        const field = await screen.findByRole('textbox', { name: 'Weather' })
        expect(field).toHaveValue('Rainy')
        expect(field).toBeDisabled()
        expect(screen.queryByRole('radio')).not.toBeInTheDocument()
      })
    })

    it('keeps a deleted step that was done but does not let it be unticked', async () => {
      mockRunPage({
        ...run,
        steps: [
          checkboxStep(null, 'Old step', { isDone: true }),
          checkboxStep(null, 'Never done'),
        ],
      })

      renderAt(runPath)

      expect(
        await screen.findByRole('checkbox', { name: 'Old step' }),
      ).toBeDisabled()
      // A deleted step that wasn't done can't be done any more, so it doesn't hold the run back.
      expect(
        screen.queryByRole('checkbox', { name: 'Never done' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('1 of 1 done')).toBeInTheDocument()
    })

    it('shows not found when the run does not exist', async () => {
      mockFetch(async () => new Response(null, { status: 404 }))

      renderAt('/runs/00000000-0000-4000-8000-000000000099')

      expect(
        await screen.findByText(
          "That fill-out doesn't exist. Its checklist may have been deleted.",
        ),
      ).toBeInTheDocument()
    })

    it('shows not found for a link from before fill-outs had keys when the run does not exist', async () => {
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

      renderAt(runPath)

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
    const inProgressKey = 'c0ffee00-0000-4000-8000-000000000006'
    const completedKey = 'c0ffee00-0000-4000-8000-000000000005'
    const inProgress = {
      id: 6,
      clientKey: inProgressKey,
      startedAt: '2026-10-07T08:00:00Z',
      completedAt: null,
    }
    const completed = {
      id: 5,
      clientKey: completedKey,
      startedAt: '2026-10-06T08:00:00Z',
      completedAt: '2026-10-06T08:30:00Z',
    }

    function local(value: string) {
      return new Date(value).toLocaleString()
    }

    function runResponse(key: string, completedAt: string | null) {
      return jsonResponse({
        id: key === inProgressKey ? 6 : 5,
        clientKey: key,
        checklistId: 3,
        checklistName: 'Morning',
        startedAt: inProgress.startedAt,
        completedAt,
        steps: [
          {
            stepId: 11,
            dependsOnStepIds: [],
            isLocked: false,
            text: 'Make coffee',
            type: 'Checkbox',
            isDone: completedAt !== null,
            completedAt: completedAt === null ? null : '2026-10-06T08:05:00Z',
            responseText: null,
            responseNumber: null,
            options: [],
            selectedOptionId: null,
            selectedOptionText: null,
          },
        ],
      })
    }

    // A fill-out on this device that the API hasn't got yet.
    function unsyncedRun(clientKey: string, startedAt: string): LocalRun {
      return createLocalRun({ ...checklist, steps: [] }, clientKey, startedAt)
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
      expect(links[0]).toHaveAttribute('href', `/runs/${inProgressKey}`)
      expect(links[0]).toHaveTextContent(
        `Started ${local(inProgress.startedAt)}In progress`,
      )
      expect(links[1]).toHaveAttribute('href', `/runs/${completedKey}`)
      expect(links[1]).toHaveTextContent(
        `Started ${local(completed.startedAt)}Completed ${local(completed.completedAt)}`,
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/3\/runs$/),
        expect.anything(),
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

    it('lists fill-outs the API has not got yet, marked as such', async () => {
      const onDevice = 'c0ffee00-0000-4000-8000-000000000007'
      await localStore().putRun(unsyncedRun(onDevice, '2026-10-08T08:00:00Z'))
      mockFetch(
        async (_url, init) =>
          init?.method === 'PUT'
            ? new Response(null, { status: 500 })
            : jsonResponse(checklist),
        async () => jsonResponse([completed]),
      )

      renderAt('/checklists/3')

      const list = await screen.findByRole('list', { name: 'Fill-outs' })
      const links = within(list).getAllByRole('link')
      expect(links).toHaveLength(2)
      expect(links[0]).toHaveAttribute('href', `/runs/${onDevice}`)
      expect(links[0]).toHaveTextContent('Not synced')
      expect(links[1]).not.toHaveTextContent('Not synced')
    })

    it('shows the fill-outs on the device when the API cannot be reached', async () => {
      const onDevice = 'c0ffee00-0000-4000-8000-000000000007'
      await localStore().putChecklist(checklist)
      await localStore().putRun(unsyncedRun(onDevice, '2026-10-08T08:00:00Z'))
      mockFetch(unreachable, unreachable)

      renderAt('/checklists/3')

      expect(
        await screen.findByText(
          "Showing the fill-outs saved on this device. Others will show once you're online.",
        ),
      ).toBeInTheDocument()
      const list = await screen.findByRole('list', { name: 'Fill-outs' })
      expect(within(list).getByRole('link')).toHaveAttribute(
        'href',
        `/runs/${onDevice}`,
      )
      expect(
        screen.queryByText('Unable to load fill-outs.'),
      ).not.toBeInTheDocument()
    })

    it('resumes a fill-out in progress', async () => {
      const user = userEvent.setup()
      mockFetch(
        async (url) =>
          url.endsWith(`/api/runs/${inProgressKey}`)
            ? runResponse(inProgressKey, null)
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
      ).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
    })

    it('opens a completed fill-out read-only', async () => {
      const user = userEvent.setup()
      mockFetch(
        async (url) =>
          url.endsWith(`/api/runs/${completedKey}`)
            ? runResponse(completedKey, completed.completedAt)
            : jsonResponse(checklist),
        async () => jsonResponse([completed]),
      )

      renderAt('/checklists/3')
      await user.click(await screen.findByRole('link', { name: /Started/ }))

      const makeCoffee = await screen.findByRole('checkbox', {
        name: 'Make coffee',
      })
      expect(makeCoffee).toBeChecked()
      expect(makeCoffee).toBeDisabled()
      // Each step's completion time is kept, but not shown.
      expect(
        screen.queryByText(local('2026-10-06T08:05:00Z'), { exact: false }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByText(`Completed ${local(completed.completedAt)}`),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Complete' }),
      ).not.toBeInTheDocument()
    })

    it('deletes a fill-out from the list, in progress or completed', async () => {
      const user = userEvent.setup()
      const fetchMock = mockFetch(
        async (_url, init) =>
          init?.method === 'DELETE'
            ? new Response(null, { status: 204 })
            : jsonResponse(checklist),
        async () => jsonResponse([inProgress, completed]),
      )

      renderAt('/checklists/3')

      await user.click(
        await screen.findByRole('button', {
          name: `Delete fill-out started ${local(completed.startedAt)}`,
        }),
      )

      const list = screen.getByRole('list', { name: 'Fill-outs' })
      await waitFor(() => {
        expect(within(list).getAllByRole('link')).toHaveLength(1)
      })
      expect(within(list).getByRole('link')).toHaveAttribute(
        'href',
        `/runs/${inProgressKey}`,
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/runs\/5$/),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(trackEvent).toHaveBeenCalledWith('RunDeleted')

      await user.click(
        screen.getByRole('button', {
          name: `Delete fill-out started ${local(inProgress.startedAt)}`,
        }),
      )

      expect(await screen.findByText('No fill-outs yet.')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/runs\/6$/),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    it('treats 404 as a successful delete from the list', async () => {
      const user = userEvent.setup()
      mockFetch(
        async (_url, init) =>
          init?.method === 'DELETE'
            ? new Response(null, { status: 404 })
            : jsonResponse(checklist),
        async () => jsonResponse([completed]),
      )

      renderAt('/checklists/3')
      await user.click(
        await screen.findByRole('button', { name: /^Delete fill-out/ }),
      )

      expect(await screen.findByText('No fill-outs yet.')).toBeInTheDocument()
      expect(
        screen.queryByText('Unable to delete this fill-out.'),
      ).not.toBeInTheDocument()
    })

    it('keeps the fill-out and shows an error when deleting it fails', async () => {
      const user = userEvent.setup()
      mockFetch(
        async (_url, init) =>
          init?.method === 'DELETE'
            ? new Response(null, { status: 500 })
            : jsonResponse(checklist),
        async () => jsonResponse([completed]),
      )

      renderAt('/checklists/3')
      await user.click(
        await screen.findByRole('button', { name: /^Delete fill-out/ }),
      )

      expect(
        await screen.findByText('Unable to delete this fill-out.'),
      ).toBeInTheDocument()
      const list = screen.getByRole('list', { name: 'Fill-outs' })
      expect(within(list).getByRole('link')).toHaveAttribute(
        'href',
        `/runs/${completedKey}`,
      )
      expect(
        screen.getByRole('button', { name: /^Delete fill-out/ }),
      ).toBeEnabled()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'deleteRun',
      })
    })

    it('deletes a fill-out on the device without waiting for the API', async () => {
      const user = userEvent.setup()
      const onDevice = 'c0ffee00-0000-4000-8000-000000000007'
      await localStore().putRun(unsyncedRun(onDevice, '2026-10-08T08:00:00Z'))
      const fetchMock = mockFetch(
        async (_url, init) =>
          init?.method === 'PUT'
            ? new Response(null, { status: 500 })
            : jsonResponse(checklist),
        async () => jsonResponse([]),
      )

      renderAt('/checklists/3')
      await user.click(
        await screen.findByRole('button', { name: /^Delete fill-out/ }),
      )

      expect(await screen.findByText('No fill-outs yet.')).toBeInTheDocument()
      expect(trackEvent).toHaveBeenCalledWith('RunDeleted')
      // The API never had it, so there's nothing to delete there.
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
      ).toBe(false)
      expect(await localStore().getRun(onDevice)).toBeUndefined()
    })

    describe('deleting from the fill-out page', () => {
      it.each([
        ['in progress', null],
        ['completed', '2026-10-07T08:30:00Z'],
      ])(
        'deletes a fill-out %s and goes back to its checklist',
        async (_state, completedAt) => {
          const user = userEvent.setup()
          let deleted = false
          const fetchMock = mockFetch(
            async (url, init) => {
              if (init?.method === 'DELETE') {
                deleted = true
                return new Response(null, { status: 204 })
              }
              return url.endsWith(`/api/runs/${inProgressKey}`)
                ? runResponse(inProgressKey, completedAt)
                : jsonResponse(checklist)
            },
            async () => jsonResponse(deleted ? [] : [inProgress]),
          )

          renderAt(`/runs/${inProgressKey}`)
          await user.click(
            await screen.findByRole('button', { name: 'Delete fill-out' }),
          )

          expect(
            await screen.findByText('No fill-outs yet.'),
          ).toBeInTheDocument()
          expect(
            screen.getByRole('heading', { level: 2, name: 'Morning' }),
          ).toBeInTheDocument()
          expect(trackEvent).toHaveBeenCalledWith('RunDeleted')
          // The API's copy goes when the device syncs.
          await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
              expect.stringMatching(/\/api\/runs\/6$/),
              expect.objectContaining({ method: 'DELETE' }),
            )
          })
          await waitFor(async () => {
            expect(await localStore().getRun(inProgressKey)).toBeUndefined()
          })
        },
      )

      it('deletes the fill-out on the device even when the API cannot be reached', async () => {
        const user = userEvent.setup()
        mockFetch(
          async (url, init) =>
            init?.method === 'DELETE'
              ? new Response(null, { status: 500 })
              : url.endsWith(`/api/runs/${inProgressKey}`)
                ? runResponse(inProgressKey, null)
                : jsonResponse(checklist),
          async () => jsonResponse([inProgress]),
        )

        renderAt(`/runs/${inProgressKey}`)
        await user.click(
          await screen.findByRole('button', { name: 'Delete fill-out' }),
        )

        // Gone from the list straight away, while the device keeps trying to delete the API's copy.
        expect(await screen.findByText('No fill-outs yet.')).toBeInTheDocument()
        expect(
          await screen.findByText('1 to sync, will retry'),
        ).toBeInTheDocument()
        expect(await localStore().getRun(inProgressKey)).toMatchObject({
          deletedAt: expect.any(String) as string,
        })
      })
    })
  })

  describe('syncing', () => {
    it('says when the fill-outs on the device have reached the API', async () => {
      const checklist = { id: 3, name: 'Morning', steps: [] }
      const onDevice = 'c0ffee00-0000-4000-8000-000000000007'
      await localStore().putRun(
        createLocalRun(checklist, onDevice, '2026-10-08T08:00:00Z'),
      )
      // The first try fails, so the fill-out is one that had been waiting.
      configureSync({ debounceMs: 0, firstRetryMs: 10 })
      let puts = 0
      mockFetch(async (_url, init) =>
        init?.method === 'PUT' && puts++ > 0
          ? jsonResponse({
              id: 9,
              clientKey: onDevice,
              checklistId: 3,
              checklistName: 'Morning',
              startedAt: '2026-10-08T08:00:00Z',
              completedAt: null,
              steps: [],
            })
          : init?.method === 'PUT'
            ? unreachable()
            : jsonResponse([]),
      )

      renderAt('/')

      expect(await screen.findByText('Synced 1 fill-out.')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(await localStore().getRun(onDevice)).toMatchObject({
        serverId: 9,
        syncedRevision: 1,
      })
    })

    it('says when the device is offline, and keeps changes to checklists for later', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      mockFetch(unreachable, unreachable)

      renderAt('/')

      expect(await screen.findByText('Offline')).toBeInTheDocument()
      expect(
        screen.getByText(
          "You're offline. Checklists saved on this device can still be filled out, but making or changing one needs a connection.",
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Create checklist' }),
      ).toBeDisabled()
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

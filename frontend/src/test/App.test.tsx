import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { trackEvent, trackException } from '../telemetry'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
}))

const unreachableMessage =
  "Can't reach CheckMate right now. It may be updating, so try again in a minute."

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request, init?: RequestInit) =>
      handler(String(input), init),
    )
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
          ? jsonResponse({ id: 1, name: 'Grocery list' })
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
      mockFetch(async () => jsonResponse({ id: 7, name: 'Packing list' }))

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
        return jsonResponse({ id: 1, name: 'My list' })
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
        return jsonResponse({ id: 1, name: 'My list' })
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

      mockFetch(async () => jsonResponse({ id: 1, name: 'My list' }))

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
      expect(fetch).toHaveBeenCalledTimes(1)
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
          ? jsonResponse({ id: 1, name: 'To delete' })
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
          ? jsonResponse({ id: 1, name: 'Already gone' })
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
        return jsonResponse({ id: 1, name: 'Persistent' })
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
        return jsonResponse({ id: 1, name: 'Persistent' })
      })

      renderAt('/checklists/1')

      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'delete',
      })
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

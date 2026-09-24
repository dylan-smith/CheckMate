import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  describe('initial render', () => {
    it('shows loading state then displays checklists', async () => {
      const checklists = [
        { id: 1, name: 'Grocery list' },
        { id: 2, name: 'Daily chores' },
      ]
      mockFetch(async () => jsonResponse(checklists))

      render(<App />)

      expect(screen.getByLabelText('Loading')).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByText('Grocery list')).toBeInTheDocument()
      })
      expect(screen.getByText('Daily chores')).toBeInTheDocument()
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
    })

    it('shows "No checklists yet." when the list is empty', async () => {
      mockFetch(async () => jsonResponse([]))

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })
    })

    it('shows error message when loading fails', async () => {
      mockFetch(async () => new Response(null, { status: 500 }))

      render(<App />)

      await waitFor(() => {
        expect(
          screen.getByText('Unable to load checklists.'),
        ).toBeInTheDocument()
      })
    })

    it('shows error message when fetch throws', async () => {
      mockFetch(async () => {
        throw new Error('Network error')
      })

      render(<App />)

      await waitFor(() => {
        expect(
          screen.getByText('Unable to load checklists.'),
        ).toBeInTheDocument()
      })
    })
  })

  describe('static content', () => {
    it('renders heading and subtitle', async () => {
      mockFetch(async () => jsonResponse([]))

      render(<App />)

      expect(
        screen.getByRole('heading', { level: 1, name: 'CheckMate' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Create, edit, and delete your custom checklists.'),
      ).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
    })

    it('renders the create checklist form', async () => {
      mockFetch(async () => jsonResponse([]))

      render(<App />)

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

      render(<App />)

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

      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New list' }),
        }),
      )
    })

    it('shows error for duplicate name (409 conflict)', async () => {
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

      render(<App />)

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
    })

    it('shows generic error when create fails with non-409 error', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return new Response(null, { status: 500 })
        }
        return jsonResponse([])
      })

      render(<App />)

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

    it('shows error when create request throws', async () => {
      const user = userEvent.setup()
      let firstLoad = true

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          throw new Error('Network error')
        }
        if (firstLoad) {
          firstLoad = false
          return jsonResponse([])
        }
        return jsonResponse([])
      })

      render(<App />)

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

    it('trims whitespace from name before submitting', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return jsonResponse({ id: 1, name: 'Trimmed' }, 201)
        }
        return jsonResponse([])
      })

      render(<App />)

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
  })

  describe('editing a checklist', () => {
    it('populates the form and changes to edit mode', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse([{ id: 1, name: 'My list' }]))

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('My list')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Edit' }))

      expect(
        screen.getByRole('heading', { level: 2, name: 'Edit checklist' }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('My list')
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    it('sends a PUT request when saving changes', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse({ id: 1, name: 'Updated list' })
        }
        return jsonResponse([{ id: 1, name: 'My list' }])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('My list')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.clear(
        screen.getByLabelText('Checklist name', { exact: false }),
      )
      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'Updated list',
      )
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/checklists\/1$/),
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ name: 'Updated list' }),
          }),
        )
      })
    })

    it('cancels editing and resets the form', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse([{ id: 1, name: 'My list' }]))

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('My list')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Edit' }))

      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('My list')

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(
        screen.getByRole('heading', { level: 2, name: 'Create checklist' }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('')
      expect(
        screen.queryByRole('button', { name: 'Cancel' }),
      ).not.toBeInTheDocument()
    })

    it('shows error for 409 conflict during edit', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return jsonResponse(
            { message: 'A checklist with this name already exists.' },
            409,
          )
        }
        return jsonResponse([{ id: 1, name: 'My list' }])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('My list')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.clear(
        screen.getByLabelText('Checklist name', { exact: false }),
      )
      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'Duplicate',
      )
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => {
        expect(
          screen.getByText('A checklist with this name already exists.'),
        ).toBeInTheDocument()
      })
    })
  })

  describe('deleting a checklist', () => {
    it('sends a DELETE request and refreshes the list', async () => {
      const user = userEvent.setup()
      let loadCount = 0

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        loadCount++
        if (loadCount <= 1) {
          return jsonResponse([{ id: 1, name: 'To delete' }])
        }
        return jsonResponse([])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('To delete')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/checklists\/1$/),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    it('treats 404 as a successful delete', async () => {
      const user = userEvent.setup()
      let loadCount = 0

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 404 })
        }
        loadCount++
        if (loadCount <= 1) {
          return jsonResponse([{ id: 1, name: 'Already gone' }])
        }
        return jsonResponse([])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('Already gone')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      expect(
        screen.queryByText('Unable to delete checklist.'),
      ).not.toBeInTheDocument()
    })

    it('shows error when delete fails', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 500 })
        }
        return jsonResponse([{ id: 1, name: 'Persistent' }])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('Persistent')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(
          screen.getByText('Unable to delete checklist.'),
        ).toBeInTheDocument()
      })
    })

    it('shows error when delete request throws', async () => {
      const user = userEvent.setup()

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          throw new Error('Network error')
        }
        return jsonResponse([{ id: 1, name: 'Persistent' }])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('Persistent')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(
          screen.getByText('Unable to delete checklist.'),
        ).toBeInTheDocument()
      })
    })

    it('cancels editing when the checklist being edited is deleted', async () => {
      const user = userEvent.setup()
      let loadCount = 0

      mockFetch(async (_url, init) => {
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        loadCount++
        if (loadCount <= 1) {
          return jsonResponse([
            { id: 1, name: 'Item A' },
            { id: 2, name: 'Item B' },
          ])
        }
        return jsonResponse([{ id: 2, name: 'Item B' }])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('Item A')).toBeInTheDocument()
      })

      const editButtons = screen.getAllByRole('button', { name: 'Edit' })
      await user.click(editButtons[0])

      expect(
        screen.getByRole('heading', { level: 2, name: 'Edit checklist' }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('Item A')

      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
      await user.click(deleteButtons[0])

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 2, name: 'Create checklist' }),
        ).toBeInTheDocument()
      })
      expect(
        screen.getByLabelText('Checklist name', { exact: false }),
      ).toHaveValue('')
    })
  })

  describe('form validation', () => {
    it('shows error when submitting only whitespace', async () => {
      const user = userEvent.setup()

      mockFetch(async () => jsonResponse([]))

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
      })

      // The input has required attribute, so we need to type whitespace then submit
      const input = screen.getByLabelText('Checklist name', { exact: false })
      await user.type(input, '   ')
      // Submit the form via the button
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(
          screen.getByText('Checklist name is required.'),
        ).toBeInTheDocument()
      })
    })

    it('clears error when starting a new action', async () => {
      const user = userEvent.setup()
      let loadCount = 0

      mockFetch(async (_url, init) => {
        if (init?.method === 'POST') {
          return new Response(null, { status: 500 })
        }
        loadCount++
        if (loadCount <= 1) {
          return jsonResponse([{ id: 1, name: 'List A' }])
        }
        return jsonResponse([{ id: 1, name: 'List A' }])
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('List A')).toBeInTheDocument()
      })

      // Trigger an error
      await user.type(
        screen.getByLabelText('Checklist name', { exact: false }),
        'Fail',
      )
      await user.click(screen.getByRole('button', { name: 'Create checklist' }))

      await waitFor(() => {
        expect(
          screen.getByText('Unable to save checklist.'),
        ).toBeInTheDocument()
      })

      // Start editing - should clear the error
      await user.click(screen.getByRole('button', { name: 'Edit' }))

      expect(
        screen.queryByText('Unable to save checklist.'),
      ).not.toBeInTheDocument()
    })
  })

  describe('multiple checklists', () => {
    it('renders edit and delete buttons for each checklist', async () => {
      mockFetch(async () =>
        jsonResponse([
          { id: 1, name: 'List A' },
          { id: 2, name: 'List B' },
          { id: 3, name: 'List C' },
        ]),
      )

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('List A')).toBeInTheDocument()
      })

      expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(3)
      expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(3)
    })
  })
})

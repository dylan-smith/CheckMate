import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { sessionFromGoogleCredential } from '../auth/google'
import { getSession, sessionStorageKey, setSession } from '../auth/session'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))

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

function authorizationOf(call: unknown[]) {
  return new Headers((call[1] as RequestInit | undefined)?.headers).get(
    'Authorization',
  )
}

afterEach(() => {
  // Signing out re-renders the app if a test left it mounted.
  act(() => setSession(null))
  vi.restoreAllMocks()
})

describe('signing in', () => {
  it('shows the sign-in page and loads nothing while signed out', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    renderAt('/')

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('signs in as a test user and sends their token with each request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse([{ id: 1, name: 'Morning' }]))
    renderAt('/')

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '  Alice  ')
    await user.click(
      screen.getByRole('button', { name: 'Sign in as test user' }),
    )

    expect(
      await screen.findByRole('link', { name: 'Morning' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(authorizationOf(fetchMock.mock.calls[0])).toBe('Bearer test:Alice')
    expect(
      JSON.parse(localStorage.getItem(sessionStorageKey) ?? '{}'),
    ).toMatchObject({ token: 'test:Alice', name: 'Alice' })
  })

  it("can't sign in as a test user without a name", async () => {
    const user = userEvent.setup()
    renderAt('/')

    await user.clear(screen.getByLabelText('Name'))

    expect(
      screen.getByRole('button', { name: 'Sign in as test user' }),
    ).toBeDisabled()
  })
})

describe('signed in', () => {
  it('signs out', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]))
    setSession({ token: 'test:Bob', name: 'Bob', provider: 'test' })
    renderAt('/')
    await screen.findByText('No checklists yet.')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem(sessionStorageKey)).toBeNull()
  })

  it('signs out when the API no longer accepts the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    )
    setSession({ token: 'expired', name: 'Carol', provider: 'google' })

    renderAt('/checklists/3')

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(getSession()).toBeNull()
  })

  it('keeps a sign-in from an earlier visit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]))
    setSession({ token: 'test:Dana', name: 'Dana', provider: 'test' })

    renderAt('/')

    expect(screen.getByText('Dana')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
    })
  })
})

describe('sessionFromGoogleCredential', () => {
  it("reads the user's name, email and picture from the ID token", () => {
    const payload = {
      sub: '123',
      name: 'Zoë Example',
      email: 'zoe@example.com',
      picture: 'https://example.com/zoe.png',
    }
    const encoded = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const credential = `header.${encoded}.signature`

    expect(sessionFromGoogleCredential(credential)).toEqual({
      token: credential,
      name: 'Zoë Example',
      email: 'zoe@example.com',
      pictureUrl: 'https://example.com/zoe.png',
      provider: 'google',
    })
  })
})

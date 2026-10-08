import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadGoogleIdentity } from '../auth/google'
import { getSession, setSession } from '../auth/session'
import SignInPage from '../auth/SignInPage'

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  googleClientId: 'client-id.apps.googleusercontent.com',
  testSignInEnabled: false,
}))

// Stands in for Google's script, which can't load in tests.
vi.mock('../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/google')>()),
  loadGoogleIdentity: vi.fn(),
}))

afterEach(() => {
  // Signing out re-renders the app if a test left it mounted.
  act(() => setSession(null))
  vi.clearAllMocks()
})

function mockGoogle() {
  let callback: ((response: { credential: string }) => void) | undefined
  const accounts = {
    initialize: vi.fn((options: { callback: typeof callback }) => {
      callback = options.callback
    }),
    renderButton: vi.fn(),
    prompt: vi.fn(),
    disableAutoSelect: vi.fn(),
  }
  vi.mocked(loadGoogleIdentity).mockResolvedValue(accounts)
  return {
    accounts,
    signIn: (credential: string) => callback?.({ credential }),
  }
}

describe('Google sign-in', () => {
  it('shows the Google button and signs in with the credential Google returns', async () => {
    const { accounts, signIn } = mockGoogle()

    render(<SignInPage />)

    await vi.waitFor(() => {
      expect(accounts.renderButton).toHaveBeenCalled()
    })
    expect(accounts.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-id.apps.googleusercontent.com',
        auto_select: true,
      }),
    )
    expect(accounts.prompt).toHaveBeenCalled()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

    const payload = btoa(
      JSON.stringify({ name: 'Eve', email: 'eve@example.com' }),
    )
    act(() => {
      signIn(`header.${payload}.signature`)
    })

    expect(getSession()).toMatchObject({
      name: 'Eve',
      email: 'eve@example.com',
      provider: 'google',
    })
  })

  it("explains when Google's script can't load", async () => {
    vi.mocked(loadGoogleIdentity).mockRejectedValue(new Error('offline'))

    render(<SignInPage />)

    expect(
      await screen.findByText(
        "Google sign-in couldn't load. Check your connection and reload the page.",
      ),
    ).toBeInTheDocument()
  })
})

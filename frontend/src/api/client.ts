import { getSession, setSession } from '../auth/session'

// fetch with the signed-in user's token. A 401 means the token has expired or isn't valid any more, so the user is
// signed out and sees the sign-in page, which brings them back to the same page once they sign in again.
export async function apiFetch(url: string, init: RequestInit = {}) {
  const session = getSession()
  const headers = new Headers(init.headers)
  if (session !== null) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }

  const response = await fetch(url, { ...init, headers })

  if (response.status === 401 && session !== null && getSession() === session) {
    setSession(null)
  }
  return response
}

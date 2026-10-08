// Trailing slashes are trimmed because callers append paths like `/api/checklists`; a base of `/` would
// otherwise produce `//api/...`, which the browser treats as a request to a host named `api`.
export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5269'
).replace(/\/+$/, '')

// Google sign-in only works on origins registered with the OAuth client, so builds for other origins (PR previews
// and E2E) leave it out and use test sign-in instead.
export const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

// Signs in as any name without a password, so it's only turned on for local development, E2E and PR previews.
export const testSignInEnabled =
  import.meta.env.VITE_ENABLE_TEST_SIGN_IN === 'true' || import.meta.env.DEV

import { test as base } from '@playwright/test'

// The E2E backend has test sign-in turned on (see playwright.config.ts), so the tests sign in as a test user: pages
// start with the user's session saved, as if they'd signed in before, and API calls send the user's token.
export const e2eUserName = 'E2E User'

export const e2eToken = `test:${e2eUserName}`

// The session the frontend saves in localStorage (see src/auth/session.ts).
export function sessionStorageEntry(name: string, token = `test:${name}`) {
  return {
    name: 'checkmate.session',
    value: JSON.stringify({ token, name, provider: 'test' }),
  }
}

export const test = base.extend({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:4173',
        localStorage: [sessionStorageEntry(e2eUserName)],
      },
    ],
  },
  // Only the API calls the tests make themselves get the header, so the pages have to send the token on their own.
  request: async ({ playwright }, provide) => {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${e2eToken}` },
    })
    await provide(request)
    await request.dispose()
  },
})

export { expect } from '@playwright/test'

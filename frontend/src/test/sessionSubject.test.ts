import { describe, expect, it } from 'vitest'
import { sessionSubject } from '../auth/session'

function googleToken(payload: object) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

// The subject is what the API files the user's data under, so it has to match the API's authentication handlers.
describe('the session subject', () => {
  it('lowercases a test sign-in name, like the API', () => {
    expect(
      sessionSubject({
        token: 'test:E2E User',
        name: 'E2E User',
        provider: 'test',
      }),
    ).toBe('test:e2e user')
  })

  it('is the service user for the service token', () => {
    expect(
      sessionSubject({ token: 'secret', name: 'CI', provider: 'service' }),
    ).toBe('service:ci')
  })

  it("is Google's id for the user from the ID token", () => {
    expect(
      sessionSubject({
        token: googleToken({ sub: '12345', email: 'd@example.com' }),
        name: 'D',
        email: 'd@example.com',
        provider: 'google',
      }),
    ).toBe('google:12345')
  })

  it('falls back to the email when the token cannot be read', () => {
    expect(
      sessionSubject({
        token: 'not-a-token',
        name: 'D',
        email: 'd@example.com',
        provider: 'google',
      }),
    ).toBe('google:d@example.com')
  })
})

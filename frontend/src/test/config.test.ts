import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadApiBaseUrl() {
  vi.resetModules()
  return (await import('../config')).apiBaseUrl
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('apiBaseUrl', () => {
  it('defaults to the local API', async () => {
    vi.stubEnv('VITE_API_BASE_URL', undefined)

    expect(await loadApiBaseUrl()).toBe('http://localhost:5269')
  })

  it.each([
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com', 'https://api.example.com'],
    ['/', ''],
    ['', ''],
  ])('turns %j into %j', async (value, expected) => {
    vi.stubEnv('VITE_API_BASE_URL', value)

    expect(await loadApiBaseUrl()).toBe(expected)
  })
})

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The service worker is ready once it has fetched every file the app needs to open, so from then on the app
// opens without the network. Playwright's offline mode applies to service workers as well as pages.
async function waitForServiceWorker(page: Page) {
  return page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
}

test.describe('Offline', () => {
  test('links the web app manifest and registers a service worker for the whole app', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    )
    expect(await waitForServiceWorker(page)).toBe('http://localhost:4173/')
  })

  test('opens without a network after one online visit', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
    await waitForServiceWorker(page)

    await context.setOffline(true)
    await page.reload()

    await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()

    // A deep link opens from the service worker too; the host's index.html fallback isn't reachable offline.
    await page.goto('/checklists/1')

    await expect(page.getByRole('heading', { name: 'CheckMate' })).toBeVisible()
  })
})

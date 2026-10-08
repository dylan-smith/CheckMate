import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpdatePrompt from '../pwa/UpdatePrompt'

// The real hook registers a service worker, which jsdom doesn't have.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }))

const mockedUseRegisterSW = vi.mocked(useRegisterSW)

function mockRegisterSW(needRefresh: boolean) {
  const setNeedRefresh = vi.fn()
  const updateServiceWorker = vi.fn(() => Promise.resolve())
  mockedUseRegisterSW.mockReturnValue({
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  })
  return { setNeedRefresh, updateServiceWorker }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('update prompt', () => {
  it('shows nothing while the current version is the latest', () => {
    mockRegisterSW(false)

    render(<UpdatePrompt />)

    expect(
      screen.queryByText('A new version of CheckMate is available.'),
    ).not.toBeInTheDocument()
  })

  it('offers to reload once a new version is ready', async () => {
    const { updateServiceWorker } = mockRegisterSW(true)
    const user = userEvent.setup()

    render(<UpdatePrompt />)

    expect(
      screen.getByText('A new version of CheckMate is available.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed until the next load', async () => {
    const { setNeedRefresh } = mockRegisterSW(true)
    const user = userEvent.setup()

    render(<UpdatePrompt />)

    await user.keyboard('{Escape}')
    expect(setNeedRefresh).toHaveBeenCalledWith(false)
  })

  it('checks for a new version now and then while online', () => {
    vi.useFakeTimers()
    const update = vi.fn(() => Promise.resolve())
    mockedUseRegisterSW.mockImplementation((options) => {
      options?.onRegisteredSW?.('/sw.js', {
        installing: null,
        update,
      } as unknown as ServiceWorkerRegistration)
      return {
        needRefresh: [false, vi.fn()],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: vi.fn(() => Promise.resolve()),
      }
    })

    render(<UpdatePrompt />)
    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(update).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

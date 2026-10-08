import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSession } from '../../auth/session'
import { createLocalRun } from '../../offline/runs'
import { getLocalStore } from '../../offline/store'
import type { LocalRun } from '../../offline/store'
import {
  configureSync,
  pushRun,
  requestSync,
  startSync,
} from '../../offline/sync'

const checklist = {
  id: 3,
  name: 'Pre-dive',
  steps: [
    {
      id: 11,
      text: 'Open valves',
      type: 'Checkbox' as const,
      sortOrder: 0,
      options: [],
      dependsOnStepIds: [],
    },
  ],
}

const key = 'c0ffee00-0000-4000-8000-000000000001'

const syncUrl =
  /\/api\/checklists\/3\/runs\/c0ffee00-0000-4000-8000-000000000001$/

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function serverRun(completedAt: string | null = null) {
  return {
    id: 9,
    clientKey: key,
    checklistId: 3,
    checklistName: 'Pre-dive',
    startedAt: '2026-10-08T08:00:00Z',
    completedAt,
    steps: [],
  }
}

function store() {
  return getLocalStore('test:diver')
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request, init?: RequestInit) =>
      handler(input instanceof Request ? input.url : input.toString(), init),
    )
}

// Resolves once the store holds a fill-out the check accepts.
async function waitForRun(check: (run: LocalRun | undefined) => boolean) {
  await vi.waitFor(async () => {
    expect(check(await store().getRun(key))).toBe(true)
  })
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

let stop: (() => void) | undefined

beforeEach(() => {
  setSession({ token: 'test:Diver', name: 'Diver', provider: 'test' })
  configureSync({ debounceMs: 0 })
})

afterEach(() => {
  stop?.()
  stop = undefined
  act(() => setSession(null))
  vi.restoreAllMocks()
})

describe('the sync engine', () => {
  it('sends a fill-out the API has not got, and keeps its id', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    const fetchMock = mockFetch(async () => jsonResponse(serverRun(), 201))

    stop = startSync()

    await waitForRun((run) => run?.serverId === 9)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(syncUrl)
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toMatchObject({
      startedAt: '2026-10-08T08:00:00Z',
      completedAt: null,
      steps: [{ stepId: 11, text: 'Open valves', type: 'Checkbox' }],
    })
    expect(await store().getRun(key)).toMatchObject({
      syncedRevision: 1,
      syncedAt: expect.any(String) as string,
    })
    // Nothing more to send.
    act(() => requestSync())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends a fill-out again when it changes while it is being sent', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    let puts = 0
    const fetchMock = mockFetch(async () => {
      puts += 1
      if (puts === 1) {
        // Changed on the device before the API answers.
        await store().updateRun(key, (run) => ({
          ...run,
          revision: run.revision + 1,
        }))
      }
      return jsonResponse(serverRun())
    })

    stop = startSync()

    await waitForRun((run) => run?.syncedRevision === 2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a rejection until the fill-out changes', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    const fetchMock = mockFetch(async () =>
      jsonResponse({ errors: { 'Steps[0]': ['Not yet.'] } }, 400),
    )

    stop = startSync()

    await waitForRun((run) => run?.syncError?.kind === 'rejected')
    expect(await store().getRun(key)).toMatchObject({
      syncError: { kind: 'rejected', message: 'Not yet.', revision: 1 },
    })
    // Not sent again as it is.
    act(() => requestSync())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await pushRun(key)).toBe('rejected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('takes the API copy when the fill-out was completed elsewhere', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    mockFetch(async (_url, init) =>
      init?.method === 'PUT'
        ? jsonResponse({ message: 'Complete.' }, 409)
        : jsonResponse(serverRun('2026-10-08T09:00:00Z')),
    )

    stop = startSync()

    await waitForRun((run) => run?.syncError?.kind === 'conflict')
    expect(await store().getRun(key)).toMatchObject({
      serverId: 9,
      completedAt: '2026-10-08T09:00:00Z',
      revision: 0,
      syncedRevision: 0,
      syncError: { kind: 'conflict', message: 'Complete.' },
    })
  })

  it('drops a fill-out whose checklist is gone', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    mockFetch(async () => new Response(null, { status: 404 }))

    stop = startSync()

    await waitForRun((run) => run === undefined)
    expect(await store().getRun(key)).toBeUndefined()
  })

  it('tries again later when the API cannot be reached, and at once when back online', async () => {
    configureSync({ debounceMs: 0, firstRetryMs: 200 })
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    let reachable = false
    const fetchMock = mockFetch(async () => {
      if (!reachable) {
        throw new TypeError('Failed to fetch')
      }
      return jsonResponse(serverRun())
    })

    stop = startSync()

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(await store().getRun(key)).toMatchObject({ syncedRevision: 0 })
    // Tried again after a while, and still waiting after that.
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(await store().getRun(key)).toMatchObject({ syncedRevision: 0 })

    reachable = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitForRun((run) => run?.syncedRevision === 1)
  })

  it('leaves the fill-outs for the next sign-in when the API signs the user out', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    const fetchMock = mockFetch(async () => new Response(null, { status: 401 }))

    stop = startSync()

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    await settle()
    expect(await store().getRun(key)).toMatchObject({ syncedRevision: 0 })

    // Signing in again sends it.
    fetchMock.mockImplementation(async () => jsonResponse(serverRun()))
    act(() =>
      setSession({ token: 'test:Diver', name: 'Diver', provider: 'test' }),
    )

    await waitForRun((run) => run?.syncedRevision === 1)
  })

  it('deletes a fill-out from the API once it is deleted here', async () => {
    await store().putRun({
      ...createLocalRun(checklist, key, '2026-10-08T08:00:00Z'),
      serverId: 9,
      syncedRevision: 1,
    })
    await store().deleteRun(key)
    const fetchMock = mockFetch(async () => new Response(null, { status: 204 }))

    stop = startSync()

    await waitForRun((run) => run === undefined)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/runs\/9$/),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('sends one fill-out straight away and says what became of it', async () => {
    await store().putRun(createLocalRun(checklist, key, '2026-10-08T08:00:00Z'))
    const fetchMock = mockFetch(async () => jsonResponse(serverRun()))
    stop = startSync()

    expect(await pushRun(key)).toBe('synced')

    // Sent once, whether by the start or the push.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(await pushRun(key)).toBe('pending')
  })
})

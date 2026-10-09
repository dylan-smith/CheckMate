import { useSyncExternalStore } from 'react'
import { ApiError, describeFetchError } from '../api/checklists'
import { deleteRun, getRunByKey, syncRun } from '../api/runs'
import { getSession, sessionSubject, subscribeSession } from '../auth/session'
import { isOnline, subscribeOnline } from './online'
import { fromServerRun, toSyncBody } from './runs'
import { getLocalStore, isDirty } from './store'
import type { LocalRun, LocalStore } from './store'

// Sends the fill-outs this device has changed to the API, whenever it can: when the app starts, after each change,
// when the browser comes back online or the app comes back into view, and again after a while when the API
// couldn't be reached. One fill-out at a time, oldest change first, and never two at once.

export type SyncStatus = {
  syncing: boolean
  // Fill-outs the API hasn't got yet.
  pendingCount: number
  // Why the last attempt couldn't reach the API, until one does.
  lastError: string | null
  lastSyncedAt: string | null
  // Counts the times fill-outs that had been waiting got through, and how many there were, so the app can say so
  // once each time. A change sent straight away doesn't count: that's the usual way.
  syncedBatches: number
  lastSyncedCount: number
}

// What became of one fill-out. pending means the API couldn't be reached, so it's tried again later.
export type SyncOutcome = 'synced' | 'pending' | 'rejected' | 'conflict'

// Synced, completed fill-outs older than this are dropped from the device; the API keeps them.
const keepCompletedForMs = 7 * 24 * 60 * 60 * 1000

const maxRetryMs = 5 * 60 * 1000

// A fill-out changed while it was being sent is sent again, but not for ever.
const maxPasses = 5

let status: SyncStatus = {
  syncing: false,
  pendingCount: 0,
  lastError: null,
  lastSyncedAt: null,
  syncedBatches: 0,
  lastSyncedCount: 0,
}

const listeners = new Set<() => void>()

function setStatus(change: Partial<SyncStatus>) {
  status = { ...status, ...change }
  listeners.forEach((listener) => listener())
}

let debounceMs = 1000

let firstRetryMs = 5000

let starts = 0

let stopListening: (() => void) | null = null

let debounceTimer: ReturnType<typeof setTimeout> | undefined

let retryTimer: ReturnType<typeof setTimeout> | undefined

let retries = 0

// Set when the browser comes back online, so the fill-outs that were waiting count as a batch.
let resumed = false

// Cleaning up old fill-outs happens once per start, not on every sync.
let cleanedUp = false

// Everything that touches the store runs through this, one task after another.
let chain: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task)
  chain = result.catch(() => undefined)
  return result
}

function currentStore(): LocalStore | null {
  const session = getSession()
  return session === null ? null : getLocalStore(sessionSubject(session))
}

function now() {
  return new Date().toISOString()
}

// Pushes one fill-out and says what became of it. Throws when the API couldn't be reached or answered with an
// error, so the loop can stop and try again later.
async function pushOne(store: LocalStore, run: LocalRun): Promise<SyncOutcome> {
  if (run.deletedAt !== null) {
    if (run.serverId !== null) {
      await deleteRun(run.serverId)
    }
    await store.removeRun(run.clientKey)
    return 'synced'
  }

  if (!isDirty(run)) {
    return 'synced'
  }

  // The API said no to this very version, and only a change can make it say yes.
  if (
    run.syncError?.kind === 'rejected' &&
    run.syncError.revision === run.revision
  ) {
    return 'rejected'
  }

  const { revision } = run
  try {
    const saved = await syncRun(run.checklistId, run.clientKey, toSyncBody(run))
    // A change made while this was sent keeps the fill-out dirty, so it's sent again.
    await store.updateRun(run.clientKey, (current) => ({
      ...current,
      serverId: saved.id,
      syncedRevision: revision,
      syncedAt: now(),
      syncError: null,
    }))
    return 'synced'
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }
    if (error.status === 400) {
      await store.updateRun(run.clientKey, (current) => ({
        ...current,
        syncError: {
          kind: 'rejected',
          message: error.message,
          revision,
          at: now(),
        },
      }))
      return 'rejected'
    }
    if (error.status === 404) {
      // The checklist was deleted, and its fill-outs with it.
      await store.removeRun(run.clientKey)
      return 'synced'
    }
    // Completed somewhere else, so the API's copy is the record from now on.
    const server = await getRunByKey(run.clientKey)
    if (server === null) {
      await store.removeRun(run.clientKey)
    } else {
      await store.putRun({
        ...fromServerRun(server, now()),
        syncError: { kind: 'conflict', message: error.message, at: now() },
      })
    }
    return 'conflict'
  }
}

async function countPending(store: LocalStore) {
  try {
    setStatus({ pendingCount: (await store.listPendingRuns()).length })
  } catch {
    // The count is only shown, so a store that can't be read leaves it as it was.
  }
}

async function runLoop() {
  const store = currentStore()
  if (store === null) {
    return
  }
  // Fill-outs that were waiting because the API couldn't be reached, or the browser was offline, make a batch
  // worth telling the user about once they're through.
  const recovering = status.lastError !== null || resumed
  resumed = false
  let reached = true
  let waiting = 0

  try {
    if (!cleanedUp) {
      cleanedUp = true
      await store.removeCompletedRunsBefore(
        new Date(Date.now() - keepCompletedForMs).toISOString(),
      )
    }
    for (let pass = 0; pass < maxPasses; pass++) {
      const pending = await store.listPendingRuns()
      if (pending.length === 0) {
        break
      }
      if (pass === 0) {
        waiting = pending.length
        setStatus({ syncing: true })
      }
      let sent = 0
      for (const run of pending) {
        // Signed out, or in as someone else, while this ran: their fill-outs aren't this store's to send.
        if (currentStore() !== store) {
          return
        }
        if ((await pushOne(store, run)) !== 'rejected') {
          sent += 1
        }
      }
      // Only a fill-out that changed while it was being sent is still pending, and it's sent again.
      if (sent === 0) {
        break
      }
    }
  } catch (error) {
    reached = false
    // Signed out by a 401, so the fill-outs wait for the user to sign in again.
    if (getSession() !== null) {
      setStatus({
        lastError: describeFetchError(error, 'Unable to sync fill-outs.'),
      })
    }
  } finally {
    await countPending(store)
    if (reached) {
      retries = 0
      setStatus({
        lastError: null,
        ...(recovering && waiting > 0 && status.pendingCount === 0
          ? {
              lastSyncedAt: now(),
              syncedBatches: status.syncedBatches + 1,
              lastSyncedCount: waiting,
            }
          : {}),
      })
    } else if (getSession() !== null) {
      scheduleRetry()
    }
    setStatus({ syncing: false })
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer)
  const delay = Math.min(firstRetryMs * 2 ** retries, maxRetryMs)
  retries += 1
  retryTimer = setTimeout(() => {
    void serialize(runLoop)
  }, delay)
}

// Syncs soon, once the changes being made have settled.
export function requestSync() {
  if (starts === 0) {
    return
  }
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void serialize(runLoop)
  }, debounceMs)
}

function syncNow() {
  clearTimeout(debounceTimer)
  clearTimeout(retryTimer)
  retries = 0
  void serialize(runLoop)
}

// Sends one fill-out straight away and says what became of it, for completing a fill-out. pending when the
// browser is offline or the API couldn't be reached; it's sent again later like any other change.
export function pushRun(clientKey: string): Promise<SyncOutcome> {
  return serialize(async () => {
    const store = currentStore()
    if (store === null || !isOnline()) {
      return 'pending'
    }
    const run = await store.getRun(clientKey)
    if (run === undefined) {
      return 'pending'
    }
    try {
      const outcome = await pushOne(store, run)
      setStatus({ lastError: null })
      return outcome
    } catch (error) {
      if (getSession() !== null) {
        setStatus({
          lastError: describeFetchError(error, 'Unable to sync fill-outs.'),
        })
        scheduleRetry()
      }
      return 'pending'
    } finally {
      await countPending(store)
    }
  })
}

// Starts syncing for the signed-in user, and returns what stops it. The app calls it once a session exists.
export function startSync(): () => void {
  starts += 1
  if (starts === 1) {
    // Asks the browser not to clear the store when space is short. Where it isn't supported, nothing happens.
    if (typeof navigator.storage?.persist === 'function') {
      void navigator.storage.persist().catch(() => undefined)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        syncNow()
      }
    }
    const onOnline = () => {
      if (isOnline()) {
        resumed = true
        syncNow()
      }
    }
    const unsubscribeOnline = subscribeOnline(onOnline)
    document.addEventListener('visibilitychange', onVisible)
    let store = currentStore()
    const onStoreChange = () => {
      if (store !== null) {
        void countPending(store)
      }
    }
    let unsubscribeStore = store?.subscribe(onStoreChange)
    const unsubscribeSession = subscribeSession(() => {
      unsubscribeStore?.()
      store = currentStore()
      unsubscribeStore = store?.subscribe(onStoreChange)
      cleanedUp = false
      if (store === null) {
        setStatus({ pendingCount: 0, lastError: null })
      } else {
        syncNow()
      }
    })
    stopListening = () => {
      unsubscribeOnline()
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribeStore?.()
      unsubscribeSession()
    }
    syncNow()
  }

  return () => {
    starts -= 1
    if (starts === 0) {
      stopListening?.()
      stopListening = null
      clearTimeout(debounceTimer)
      clearTimeout(retryTimer)
    }
  }
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => status)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Only for tests.
export function configureSync(options: {
  debounceMs?: number
  firstRetryMs?: number
}) {
  debounceMs = options.debounceMs ?? debounceMs
  firstRetryMs = options.firstRetryMs ?? firstRetryMs
}

// Only for tests, so each one starts with nothing pending or scheduled.
export function resetSync() {
  stopListening?.()
  stopListening = null
  starts = 0
  clearTimeout(debounceTimer)
  clearTimeout(retryTimer)
  retries = 0
  resumed = false
  cleanedUp = false
  debounceMs = 1000
  firstRetryMs = 5000
  chain = Promise.resolve()
  status = {
    syncing: false,
    pendingCount: 0,
    lastError: null,
    lastSyncedAt: null,
    syncedBatches: 0,
    lastSyncedCount: 0,
  }
  listeners.forEach((listener) => listener())
}

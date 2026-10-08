import { useMemo } from 'react'
import type { Checklist, ChecklistDetail, StepOption } from '../api/checklists'
import type { StepType } from '../api/checklists'
import { sessionSubject, useSession } from '../auth/session'
import { get, getAll, openDb, put, remove, update } from './db'

// A step of a fill-out as this device keeps it: what the step showed when the fill-out started, and the answer.
// It's what the run page shows, and what the API gets when the fill-out is synced.
export type LocalRunStep = {
  // null only on a fill-out copied from the API after the step was deleted from the checklist.
  stepId: number | null
  text: string
  type: StepType
  sortOrder: number
  options: StepOption[]
  dependsOnStepIds: number[]
  isDone: boolean
  // When this device marked the step done.
  completedAt: string | null
  responseText: string | null
  responseNumber: number | null
  selectedOptionId: number | null
  selectedOptionText: string | null
}

// Why the API didn't take the fill-out as it is. rejected needs the user to change something, and is kept until
// the fill-out changes again. conflict means it was completed somewhere else, and the local copy is now the API's.
export type SyncError =
  | { kind: 'rejected'; message: string; revision: number; at: string }
  | { kind: 'conflict'; message: string; at: string }

// A fill-out as this device keeps it. Every change is saved here first, and the sync engine (sync.ts) sends it
// to the API when it can. revision counts the changes and syncedRevision the last one the API took, so the
// fill-out is dirty while they differ. serverId is the API's id once it has one. deletedAt marks a fill-out the
// user deleted, which stays until the API has deleted it too.
export type LocalRun = {
  clientKey: string
  serverId: number | null
  checklistId: number
  checklistName: string
  startedAt: string
  completedAt: string | null
  steps: LocalRunStep[]
  revision: number
  syncedRevision: number
  updatedAt: string
  syncedAt: string | null
  syncError: SyncError | null
  deletedAt: string | null
}

export type CachedChecklist = ChecklistDetail & { cachedAt: string }

type CachedChecklistList = {
  key: 'checklistList'
  value: Checklist[]
  cachedAt: string
}

export function isDirty(run: LocalRun) {
  return run.revision !== run.syncedRevision || run.deletedAt !== null
}

export type LocalStore = {
  getRun(clientKey: string): Promise<LocalRun | undefined>
  putRun(run: LocalRun): Promise<void>
  // Resolves to the saved fill-out, or undefined when there's no fill-out with the key.
  updateRun(
    clientKey: string,
    change: (run: LocalRun) => LocalRun,
  ): Promise<LocalRun | undefined>
  // A checklist's fill-outs, including ones deleted on this device that the API still has.
  listRuns(checklistId: number): Promise<LocalRun[]>
  // Every fill-out the API hasn't got yet, oldest change first.
  listPendingRuns(): Promise<LocalRun[]>
  // Marks a fill-out deleted, or removes it outright when the API never had it.
  deleteRun(clientKey: string): Promise<void>
  removeRun(clientKey: string): Promise<void>
  // Removes completed fill-outs the API has, once they're older than this. The API keeps the record.
  removeCompletedRunsBefore(cutoff: string): Promise<void>
  getChecklist(id: number): Promise<CachedChecklist | undefined>
  putChecklist(checklist: ChecklistDetail): Promise<void>
  removeChecklist(id: number): Promise<void>
  getChecklistList(): Promise<Checklist[] | undefined>
  // Keeps the list, and drops cached checklists that aren't in it any more.
  putChecklistList(list: Checklist[]): Promise<void>
  // Called after every write, so pages can show what the sync engine changed.
  subscribe(listener: () => void): () => void
}

function createLocalStore(name: string): LocalStore {
  let db: Promise<IDBDatabase> | undefined
  const listeners = new Set<() => void>()

  function open() {
    db ??= openDb(name)
    return db
  }

  function notify() {
    listeners.forEach((listener) => listener())
  }

  async function removeRun(clientKey: string) {
    await remove(await open(), 'runs', clientKey)
    notify()
  }

  const store: LocalStore = {
    async getRun(clientKey) {
      return get<LocalRun>(await open(), 'runs', clientKey)
    },
    async putRun(run) {
      await put(await open(), 'runs', run)
      notify()
    },
    async updateRun(clientKey, change) {
      const saved = await update(await open(), 'runs', clientKey, change)
      if (saved !== undefined) {
        notify()
      }
      return saved
    },
    async listRuns(checklistId) {
      return getAll<LocalRun>(await open(), 'runs', 'checklistId', checklistId)
    },
    async listPendingRuns() {
      const runs = await getAll<LocalRun>(await open(), 'runs')
      return runs
        .filter(isDirty)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    },
    async deleteRun(clientKey) {
      const run = await store.getRun(clientKey)
      if (run === undefined) {
        return
      }
      if (run.serverId === null) {
        await removeRun(clientKey)
        return
      }
      const now = new Date().toISOString()
      await store.updateRun(clientKey, (current) => ({
        ...current,
        deletedAt: now,
        updatedAt: now,
      }))
    },
    removeRun,
    async removeCompletedRunsBefore(cutoff) {
      const runs = await getAll<LocalRun>(await open(), 'runs')
      const stale = runs.filter(
        (run) =>
          !isDirty(run) && run.completedAt !== null && run.completedAt < cutoff,
      )
      for (const run of stale) {
        await remove(await open(), 'runs', run.clientKey)
      }
      if (stale.length > 0) {
        notify()
      }
    },
    async getChecklist(id) {
      return get<CachedChecklist>(await open(), 'checklists', id)
    },
    async putChecklist(checklist) {
      await put<CachedChecklist>(await open(), 'checklists', {
        ...checklist,
        cachedAt: new Date().toISOString(),
      })
    },
    async removeChecklist(id) {
      await remove(await open(), 'checklists', id)
    },
    async getChecklistList() {
      const cached = await get<CachedChecklistList>(
        await open(),
        'meta',
        'checklistList',
      )
      return cached?.value
    },
    async putChecklistList(list) {
      const database = await open()
      await put<CachedChecklistList>(database, 'meta', {
        key: 'checklistList',
        value: list,
        cachedAt: new Date().toISOString(),
      })
      const ids = new Set(list.map((checklist) => checklist.id))
      const cached = await getAll<CachedChecklist>(database, 'checklists')
      for (const checklist of cached) {
        if (!ids.has(checklist.id)) {
          await remove(database, 'checklists', checklist.id)
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return store
}

// One store per user, named after the identity the API files their data under, so two people sharing a phone
// never see each other's fill-outs. It's opened the first time it's used.
const stores = new Map<string, LocalStore>()

export function getLocalStore(subject: string): LocalStore {
  let store = stores.get(subject)
  if (store === undefined) {
    store = createLocalStore(`checkmate.${subject}`)
    stores.set(subject, store)
  }
  return store
}

// The signed-in user's store. Only for pages the app shows once signed in.
export function useLocalStore(): LocalStore {
  const session = useSession()
  if (session === null) {
    throw new Error('The local store needs a signed-in user.')
  }
  const subject = sessionSubject(session)
  return useMemo(() => getLocalStore(subject), [subject])
}

// Only for tests, so each one starts with no store open.
export function resetLocalStores() {
  stores.clear()
}

import { getChecklist, listChecklists } from '../api/checklists'
import type { Checklist, ChecklistDetail } from '../api/checklists'
import { getSession, sessionSubject } from '../auth/session'
import { isOnline } from './online'
import type { LocalStore } from './store'
import { getLocalStore } from './store'

// Checklists come from the API, and every one the app sees is kept on the device, so they can be filled out
// without a connection. fromCache says the API couldn't be reached and this is the copy the device has.
export type Loaded<T> = { data: T; fromCache: boolean }

function currentStore(): LocalStore | null {
  const session = getSession()
  return session === null ? null : getLocalStore(sessionSubject(session))
}

// Keeping a copy is best-effort: the storage can be unavailable, say in a private window, and the page has what
// it needs either way.
function keep(write: Promise<void>) {
  write.catch(() => undefined)
}

export async function loadChecklists(): Promise<Loaded<Checklist[]>> {
  const store = currentStore()
  try {
    const list = await listChecklists()
    if (store !== null) {
      keep(store.putChecklistList(list))
    }
    return { data: list, fromCache: false }
  } catch (error) {
    if (store !== null && error instanceof TypeError) {
      const cached = await store.getChecklistList().catch(() => undefined)
      if (cached !== undefined) {
        return { data: cached, fromCache: true }
      }
    }
    throw error
  }
}

// Returns null when there's no checklist with this id.
export async function loadChecklist(
  id: number,
): Promise<Loaded<ChecklistDetail> | null> {
  const store = currentStore()
  try {
    const checklist = await getChecklist(id)
    if (store !== null) {
      keep(
        checklist === null
          ? store.removeChecklist(id)
          : store.putChecklist(checklist),
      )
    }
    return checklist === null ? null : { data: checklist, fromCache: false }
  } catch (error) {
    if (store !== null && error instanceof TypeError) {
      const cached = await store.getChecklist(id).catch(() => undefined)
      if (cached !== undefined) {
        const { id: cachedId, name, steps } = cached
        return { data: { id: cachedId, name, steps }, fromCache: true }
      }
    }
    throw error
  }
}

let prefetching: Promise<void> = Promise.resolve()

// Fetches each checklist's steps in the background, one at a time, so every checklist in the list can be filled
// out offline later. Nothing is reported: the next online visit tries again.
export function prefetchChecklists(list: Checklist[]) {
  const store = currentStore()
  if (store === null || !isOnline()) {
    return
  }
  prefetching = prefetching.then(async () => {
    for (const { id } of list) {
      try {
        const checklist = await getChecklist(id)
        if (checklist !== null) {
          await store.putChecklist(checklist)
        }
      } catch {
        return
      }
    }
  })
}

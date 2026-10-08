import { describe, expect, it, vi } from 'vitest'
import { createLocalRun } from '../../offline/runs'
import { getLocalStore, isDirty } from '../../offline/store'

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

const keyA = 'c0ffee00-0000-4000-8000-00000000000a'

const keyB = 'c0ffee00-0000-4000-8000-00000000000b'

describe('the local store', () => {
  it('keeps a fill-out and reads it back', async () => {
    const store = getLocalStore('test:diver')
    const run = createLocalRun(checklist, keyA, '2026-10-08T08:00:00Z')

    await store.putRun(run)

    expect(await store.getRun(keyA)).toEqual(run)
    expect(await store.getRun(keyB)).toBeUndefined()
  })

  it('applies two changes made at once without losing either', async () => {
    const store = getLocalStore('test:diver')
    await store.putRun(createLocalRun(checklist, keyA, '2026-10-08T08:00:00Z'))

    await Promise.all([
      store.updateRun(keyA, (run) => ({ ...run, revision: run.revision + 1 })),
      store.updateRun(keyA, (run) => ({ ...run, revision: run.revision + 1 })),
    ])

    expect((await store.getRun(keyA))?.revision).toBe(3)
  })

  it('resolves to undefined when changing a fill-out it does not have', async () => {
    const store = getLocalStore('test:diver')

    expect(await store.updateRun(keyA, (run) => run)).toBeUndefined()
  })

  it('lists what the API has not got yet, oldest change first', async () => {
    const store = getLocalStore('test:diver')
    const synced = {
      ...createLocalRun(checklist, keyA, '2026-10-08T08:00:00Z'),
      serverId: 1,
      syncedRevision: 1,
    }
    const dirty = createLocalRun(checklist, keyB, '2026-10-08T07:00:00Z')
    await store.putRun(synced)
    await store.putRun(dirty)

    expect(isDirty(synced)).toBe(false)
    expect(isDirty(dirty)).toBe(true)
    expect((await store.listPendingRuns()).map((run) => run.clientKey)).toEqual(
      [keyB],
    )
    expect(
      (await store.listRuns(3)).map((run) => run.clientKey).sort(),
    ).toEqual([keyA, keyB])
    expect(await store.listRuns(4)).toEqual([])
  })

  it('removes a fill-out the API never had, and marks one it has as deleted', async () => {
    const store = getLocalStore('test:diver')
    await store.putRun(createLocalRun(checklist, keyA, '2026-10-08T08:00:00Z'))
    await store.putRun({
      ...createLocalRun(checklist, keyB, '2026-10-08T08:00:00Z'),
      serverId: 2,
      syncedRevision: 1,
    })

    await store.deleteRun(keyA)
    await store.deleteRun(keyB)

    expect(await store.getRun(keyA)).toBeUndefined()
    const deleted = await store.getRun(keyB)
    expect(deleted?.deletedAt).toEqual(expect.any(String))
    expect(isDirty(deleted!)).toBe(true)
    expect((await store.listPendingRuns()).map((run) => run.clientKey)).toEqual(
      [keyB],
    )
  })

  it('drops synced, completed fill-outs older than the cutoff', async () => {
    const store = getLocalStore('test:diver')
    const old = {
      ...createLocalRun(checklist, keyA, '2026-09-01T08:00:00Z'),
      serverId: 1,
      syncedRevision: 1,
      completedAt: '2026-09-01T09:00:00Z',
    }
    const oldButUnsynced = {
      ...createLocalRun(checklist, keyB, '2026-09-01T08:00:00Z'),
      completedAt: '2026-09-01T09:00:00Z',
    }
    await store.putRun(old)
    await store.putRun(oldButUnsynced)

    await store.removeCompletedRunsBefore('2026-10-01T00:00:00Z')

    expect(await store.getRun(keyA)).toBeUndefined()
    expect(await store.getRun(keyB)).toBeDefined()
  })

  it('keeps the checklists, and drops ones that are no longer listed', async () => {
    const store = getLocalStore('test:diver')
    await store.putChecklist(checklist)
    await store.putChecklist({ ...checklist, id: 4, name: 'Post-dive' })

    await store.putChecklistList([{ id: 3, name: 'Pre-dive' }])

    expect(await store.getChecklistList()).toEqual([
      { id: 3, name: 'Pre-dive' },
    ])
    expect(await store.getChecklist(3)).toMatchObject({ name: 'Pre-dive' })
    expect(await store.getChecklist(4)).toBeUndefined()
  })

  it('keeps each user apart', async () => {
    await getLocalStore('test:diver').putRun(
      createLocalRun(checklist, keyA, '2026-10-08T08:00:00Z'),
    )

    expect(await getLocalStore('test:buddy').getRun(keyA)).toBeUndefined()
    expect(await getLocalStore('test:diver').getRun(keyA)).toBeDefined()
  })

  it('tells listeners after each write', async () => {
    const store = getLocalStore('test:diver')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.putRun(createLocalRun(checklist, keyA, '2026-10-08T08:00:00Z'))
    await store.updateRun(keyA, (run) => run)
    await store.removeRun(keyA)
    unsubscribe()
    await store.putRun(createLocalRun(checklist, keyB, '2026-10-08T08:00:00Z'))

    expect(listener).toHaveBeenCalledTimes(3)
  })
})

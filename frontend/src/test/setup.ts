import '@testing-library/jest-dom/vitest'
// jsdom has no IndexedDB, which the app keeps fill-outs and checklists in.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach } from 'vitest'
import { resetLocalStores } from '../offline/store'
import { resetSync } from '../offline/sync'

// Each test starts with an empty device and nothing waiting to sync.
afterEach(() => {
  resetSync()
  resetLocalStores()
  globalThis.indexedDB = new IDBFactory()
})

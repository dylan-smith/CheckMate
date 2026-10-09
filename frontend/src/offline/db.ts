// A small promise wrapper over IndexedDB, which is where the app keeps fill-outs and the checklists it has seen so
// they're there without a connection (see store.ts). Each function runs in its own transaction.

const version = 1

export type StoreName = 'runs' | 'checklists' | 'meta'

export function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('runs', { keyPath: 'clientKey' }).createIndex(
        'checklistId',
        'checklistId',
      )
      db.createObjectStore('checklists', { keyPath: 'id' })
      db.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(errorOf(request.error))
  })
}

function errorOf(error: DOMException | null) {
  return error ?? new Error('The browser storage is not available.')
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(errorOf(request.error))
  })
}

// Resolves once the transaction has committed, so a write is on disk before the caller goes on.
function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(errorOf(transaction.error))
    transaction.onabort = () => reject(errorOf(transaction.error))
  })
}

export async function get<T>(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  const request = db
    .transaction(store, 'readonly')
    .objectStore(store)
    .get(key) as IDBRequest<T | undefined>
  return awaitRequest(request)
}

export async function getAll<T>(
  db: IDBDatabase,
  store: StoreName,
  index?: string,
  query?: IDBValidKey,
): Promise<T[]> {
  const objectStore = db.transaction(store, 'readonly').objectStore(store)
  const request = (
    index === undefined
      ? objectStore.getAll()
      : objectStore.index(index).getAll(query)
  ) as IDBRequest<T[]>
  return awaitRequest(request)
}

export async function put<T>(
  db: IDBDatabase,
  store: StoreName,
  value: T,
): Promise<void> {
  const transaction = db.transaction(store, 'readwrite')
  transaction.objectStore(store).put(value)
  await awaitTransaction(transaction)
}

export async function remove(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const transaction = db.transaction(store, 'readwrite')
  transaction.objectStore(store).delete(key)
  await awaitTransaction(transaction)
}

// Reads and writes in one transaction, so two changes to the same record can't lose each other. Resolves to
// the saved value, or undefined when there's no record with the key.
export async function update<T>(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
  change: (current: T) => T,
): Promise<T | undefined> {
  const transaction = db.transaction(store, 'readwrite')
  const objectStore = transaction.objectStore(store)
  const current = await awaitRequest(
    objectStore.get(key) as IDBRequest<T | undefined>,
  )
  if (current === undefined) {
    return undefined
  }
  const next = change(current)
  objectStore.put(next)
  await awaitTransaction(transaction)
  return next
}

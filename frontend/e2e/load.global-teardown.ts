// Deletes any checklists the load run left behind, e.g. when a visit failed between creating and deleting one.
// load.spec.ts writes the id of each checklist it has in flight to a file per virtual user in pendingDir and
// removes the file once the checklist is deleted, so only ids this run created are ever deleted. Each deletion
// is checked, and the sweep is retried while any remain, since the API may be paused by a deployment or
// waiting for the database to resume.

import { readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const pendingDir = fileURLToPath(
  new URL('../test-results/load-pending/', import.meta.url),
)

const ATTEMPTS = 3
const RETRY_DELAY_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pendingIds() {
  let files: string[]
  try {
    files = readdirSync(pendingDir)
  } catch {
    return []
  }
  return files.map((file) => ({
    file: path.join(pendingDir, file),
    id: readFileSync(path.join(pendingDir, file), 'utf8').trim(),
  }))
}

// Deletes the pending checklists it can and returns the ids still there.
async function deletePending(apiUrl: string) {
  const remaining: string[] = []
  for (const { file, id } of pendingIds()) {
    let outcome: string
    try {
      const response = await fetch(
        new URL(`/api/checklists/${id}`, apiUrl).toString(),
        { method: 'DELETE', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )
      if (response.status === 204 || response.status === 404) {
        console.log(`[load] Deleted leftover checklist ${id}`)
        rmSync(file, { force: true })
        continue
      }
      outcome = `HTTP ${response.status}`
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error)
    }
    console.log(`[load] Could not delete leftover checklist ${id}: ${outcome}`)
    remaining.push(id)
  }
  return remaining
}

export default async function globalTeardown() {
  const apiUrl = process.env.LOAD_API_URL
  if (!apiUrl) {
    console.log('[load] LOAD_API_URL not set; skipping leftover cleanup.')
    return
  }

  console.log('[load] Deleting any checklists left behind')
  let remaining: string[] = []
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    remaining = await deletePending(apiUrl)
    if (remaining.length === 0) {
      console.log('[load] No checklists left behind.')
      return
    }
    if (attempt < ATTEMPTS) {
      console.log(
        `[load] Retrying the cleanup in ${RETRY_DELAY_MS / 1000} seconds`,
      )
      await sleep(RETRY_DELAY_MS)
    }
  }
  console.log(
    `::warning::Could not delete leftover checklist(s) with id ${remaining.join(', ')}; delete them by hand once the API is reachable`,
  )
}

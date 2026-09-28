// Deletes any checklists the load run left behind, e.g. when a visit failed between creating and deleting one.
// Each deletion is checked, and the sweep is retried while any remain, since the API may be paused by a
// deployment or waiting for the database to resume. Matches the names load.spec.ts creates, so the prefix
// lives here and the spec imports it.

export const checklistPrefix = `Load test web ${process.env.GITHUB_RUN_ID ?? 'local'}`

const ATTEMPTS = 3
const RETRY_DELAY_MS = 10_000
const REQUEST_TIMEOUT_MS = 60_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// Deletes the leftovers it can and returns how many are still there, or 1 when the list itself failed.
async function deleteLeftovers(url: string) {
  let leftovers: { id: number; name: string }[]
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    leftovers = (
      (await response.json()) as { id: number; name: string }[]
    ).filter(({ name }) => name.startsWith(checklistPrefix))
  } catch (error) {
    console.log(`[load] Could not list checklists: ${describe(error)}`)
    return 1
  }

  let remaining = 0
  for (const { id, name } of leftovers) {
    let outcome: string
    try {
      const response = await fetch(`${url}/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.status === 204 || response.status === 404) {
        console.log(`[load] Deleted leftover checklist ${id} (${name})`)
        continue
      }
      outcome = `HTTP ${response.status}`
    } catch (error) {
      outcome = describe(error)
    }
    console.log(`[load] Could not delete leftover checklist ${id}: ${outcome}`)
    remaining++
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
  const url = new URL('/api/checklists', apiUrl).toString()
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if ((await deleteLeftovers(url)) === 0) {
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
    `::warning::Could not delete every checklist named '${checklistPrefix}'; delete them by hand once the API is reachable`,
  )
}

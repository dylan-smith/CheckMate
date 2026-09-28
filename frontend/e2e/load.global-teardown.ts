// Deletes any checklists the load run left behind, e.g. when a visit failed between creating and deleting one.
// Matches the names load.spec.ts creates, so the prefix lives here and the spec imports it.

export const checklistPrefix = `Load test web ${process.env.GITHUB_RUN_ID ?? 'local'}`

export default async function globalTeardown() {
  const apiUrl = process.env.LOAD_API_URL
  if (!apiUrl) {
    console.log('[load] LOAD_API_URL not set; skipping leftover cleanup.')
    return
  }

  const url = new URL('/api/checklists', apiUrl).toString()
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) {
    console.log(
      `[load] Could not list checklists for cleanup (HTTP ${response.status}).`,
    )
    return
  }

  const leftovers = (
    (await response.json()) as { id: number; name: string }[]
  ).filter(({ name }) => name.startsWith(checklistPrefix))
  for (const { id, name } of leftovers) {
    console.log(`[load] Deleting leftover checklist ${id} (${name})`)
    await fetch(`${url}/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(60_000),
    })
  }
  console.log(`[load] Deleted ${leftovers.length} leftover checklist(s).`)
}

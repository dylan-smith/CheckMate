// Waits for the deployed API to become healthy before the smoke tests run.
//
// Right after a deployment the App Service restarts, and on the free plan the serverless
// database may still be resuming from auto-pause, so the first requests can be slow or fail.
// Poll the API until it answers the frontend's own request (GET /api/checklists with the
// frontend's Origin) with a 200 and a matching CORS header, then let the tests run.

const POLL_INTERVAL_MS = 10_000
// A request made while the app is starting waits for startup, which includes up to 90 seconds
// of database connectivity checks, so each attempt gets a generous timeout of its own.
const REQUEST_TIMEOUT_MS = 150_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default async function globalSetup() {
  const apiUrl = process.env.SMOKE_API_URL
  if (!apiUrl) {
    console.log('[smoke] SMOKE_API_URL not set; skipping API readiness check.')
    return
  }

  const origin = new URL(process.env.SMOKE_BASE_URL ?? 'http://localhost:4173')
    .origin
  const url = new URL('/api/checklists', apiUrl).toString()
  const timeoutMs = Number(process.env.SMOKE_READY_TIMEOUT_MS ?? 6 * 60_000)
  const deadline = Date.now() + timeoutMs

  for (let attempt = 1; ; attempt++) {
    let outcome: string
    try {
      const response = await fetch(url, {
        headers: { Origin: origin },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const allowOrigin = response.headers.get('access-control-allow-origin')
      if (response.ok && (allowOrigin === origin || allowOrigin === '*')) {
        console.log(`[smoke] API is healthy after ${attempt} attempt(s).`)
        return
      }
      outcome = `HTTP ${response.status}, Access-Control-Allow-Origin: ${allowOrigin ?? '(none)'}`
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error)
    }

    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      throw new Error(
        `[smoke] API at ${url} did not become healthy within ${timeoutMs / 1000}s. Last result: ${outcome}`,
      )
    }
    console.log(
      `[smoke] Attempt ${attempt}: ${outcome}; retrying in ${POLL_INTERVAL_MS / 1000}s...`,
    )
    await sleep(POLL_INTERVAL_MS)
  }
}

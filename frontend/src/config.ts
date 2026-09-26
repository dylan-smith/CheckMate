// Trailing slashes are trimmed because callers append paths like `/api/checklists`; a base of `/` would
// otherwise produce `//api/...`, which the browser treats as a request to a host named `api`.
export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5269'
).replace(/\/+$/, '')

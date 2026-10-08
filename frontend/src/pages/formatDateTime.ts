// The API sends UTC times, shown here in the browser's time zone and locale.
export function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

// Only positive whole numbers can be ids, so anything else can't match one.
export function parseId(value: string | undefined) {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : null
}
